const spotifyUtils = require('../utils/spotify');
const { randomNiceEmoji } = require('../utils');
const spotifyUri = require('spotify-uri');

const linkRegex = new RegExp('(https?://(open|play).spotify.com/track/|spotify:track:)\\S+');
const spotifyApi = spotifyUtils.client;

const redis = require('../utils/redis').connect();

///////////////////////////////

setTimeout(() => process.exit(1), 3600000);

///////////////////////////////

const getAllTracksFromPlaylist = async () => {
    const knownTrackURIs = [];

    let offset = 0;
    let limit = 100;

    try {
        while(true) {
            const res = await spotifyApi.getPlaylistTracks(
                process.env.SPOTIFY_PLAYLIST_ID,
                {
                    offset,
                    limit
                }
            );

            if (res.body.items.length === 0) {
                break;
            }

            knownTrackURIs.push(
                ...res.body.items.map(item => item.track.uri)
            );

            offset += limit;
        }
    } catch(err) {}

    return knownTrackURIs;
}

module.exports = (robot) => {
    robot.hear(linkRegex, async (msg) => {
        if (await redis.get(String(msg.message.id)) === '1') {
            // duplicate message...
            return;
        }

        await redis.set(String(msg.message.id), '1', 'EX', 20);

        const match = String(msg.match[0].split('?').shift());

        const mediaId = `${match}¡${msg.message.room}`;

        if (await redis.get(mediaId) === '1') {
            return;
        }

        await redis.set(mediaId, '1', 'EX', 120);

        const parsed = spotifyUri.parse(match);

        if (parsed.type !== 'track') {
            console.error('Only track type spotify links are supported!');
            console.error(parsed);
            return;
        }

        try {
            const trackURI = (await spotifyApi.getTrack(parsed.id)).body.uri;

            const knownTracks = await getAllTracksFromPlaylist();
            const knownTrackPos = knownTracks.indexOf(trackURI);

            if (knownTrackPos > -1) {
                if (knownTrackPos !== 0) {
                    await spotifyApi.reorderTracksInPlaylist(
                        process.env.SPOTIFY_PLAYLIST_ID,
                        knownTrackPos,
                        0
                    );

                    msg.send(`Track already in playlist, moved it to the top.`);
                }
            } else {
                await spotifyApi.addTracksToPlaylist(
                    process.env.SPOTIFY_PLAYLIST_ID,
                    [ trackURI ],
                    { position: 0 }
                );

                msg.send(`Track added to playlist!`);
            }
        } catch(err) {
            msg.send(`Failed to add track to playlist 😓  "${err.message}"`);
        }
    });
};
