const YOUTUBE_API_KEY = "AIzaSyAX98Zxj_nhT0GgMq9YxoZNodeHMYmr1ZY"; // this is just the localhost key, I will not share it I will share the only ristricted for https://deutschmeister.netlify.app key separately
export const PLAYLISTS = {
	A1: 'PLF9mJC4RrjIhS4MMm0x72-qWEn1LRvPuW',
	A2: 'PLF9mJC4RrjIhv0_YjWvC0pmM1EZlVylBt',
	B1: 'PLF9mJC4RrjIhhEGuI2x4_WWaIyn9q7MzV',
	B2: 'PLF9mJC4RrjIirvi-7FRT0hPbdfwcmFDH1',
	C1: 'PLF9mJC4RrjIjlxkiVa8VEG55Lp9TcJMKP',
};

// A cache to store all video data to avoid re-fetching
const allVideosCache = {};

// Helper function to parse ISO 8601 duration format from YouTube API
function parseISO8601Duration(duration) {
	const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
	if (!match) return 0;
	const hours = (parseInt(match[1], 10) || 0);
	const minutes = (parseInt(match[2], 10) || 0);
	const seconds = (parseInt(match[3], 10) || 0);
	return hours * 3600 + minutes * 60 + seconds;
}


async function fetchPlaylistVideoCounts() {
	if (YOUTUBE_API_KEY === "YOUR_NEW_API_KEY_HERE") {
		console.warn("WARNING: YouTube API Key is still a generic placeholder. Please replace it with your public key.");
		return null;
	}
	const playlistIds = Object.values(PLAYLISTS).join(',');
	const url = `https://www.googleapis.com/youtube/v3/playlists?part=contentDetails&id=${playlistIds}&key=${YOUTUBE_API_KEY}`;
	try {
		const response = await fetch(url);
		const data = await response.json();
		if (!response.ok) throw new Error(data.error.message || "Failed to fetch from YouTube API");
		const videoCounts = {};
		data.items.forEach(item => {
			const level = Object.keys(PLAYLISTS).find(key => PLAYLISTS[key] === item.id);
			if (level) {
				videoCounts[level] = {
					totalVideos: item.contentDetails.itemCount,
					playlistId: item.id
				};
			}
		});
		return videoCounts;
	} catch (error) {
		console.error("Error fetching playlist counts:", error);
		throw new Error('Could not fetch course data from YouTube.');
	}
}


async function getAndCacheVideosForLevel(level) {
	const playlistId = PLAYLISTS[level];
	if (!playlistId) return [];

	// Check if videos for this level are already in cache
	const cachedVideos = Object.values(allVideosCache).filter(v => v.level === level);
	if (cachedVideos.length > 0) {
		return cachedVideos.sort((a, b) => a.index - b.index);
	}

	console.log(`Fetching raw video data for level ${level} for the first time...`);
	let allPlaylistItems = [];
	let nextPageToken = '';
	const urlBase = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}`;
	try {
		// 1. Fetch all video IDs from the playlist
		do {
			const url = nextPageToken ? `${urlBase}&pageToken=${nextPageToken}` : urlBase;
			const response = await fetch(url);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error?.message || 'Failed to fetch playlist items');
			allPlaylistItems = allPlaylistItems.concat(data.items);
			nextPageToken = data.nextPageToken;
		} while (nextPageToken);

		const videoIds = allPlaylistItems
			.map(item => item.snippet.resourceId.videoId)
			.filter(id => id); // Filter out any null/undefined IDs

		// 2. Fetch contentDetails (including duration) for all videos in one go
		const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`;
		const detailsResponse = await fetch(detailsUrl);
		const detailsData = await detailsResponse.json();
		if (!detailsResponse.ok) throw new Error(detailsData.error?.message || 'Failed to fetch video details');

		const durationsMap = new Map();
		detailsData.items.forEach(item => {
			durationsMap.set(item.id, parseISO8601Duration(item.contentDetails.duration));
		});

		// 3. Combine snippet data with duration and cache it
		allPlaylistItems.forEach((item, index) => {
			const videoId = item.snippet.resourceId.videoId;
			const thumbnails = item.snippet.thumbnails;
			const thumbnailUrl = (thumbnails.standard && thumbnails.standard.url) ||
				(thumbnails.high && thumbnails.high.url) ||
				(thumbnails.medium && thumbnails.medium.url) ||
				thumbnails.default.url;

			// Add to the global cache
			allVideosCache[videoId] = {
				videoId,
				title: item.snippet.title,
				thumbnail: thumbnailUrl,
				durationInSeconds: durationsMap.get(videoId) || 0,
				level: level,
				playlistId: playlistId,
				index: index
			};
		});

		const finalVideosForLevel = Object.values(allVideosCache).filter(v => v.level === level);
		return finalVideosForLevel.sort((a, b) => a.index - b.index);

	} catch (error) {
		console.error(`Error fetching videos for level ${level}:`, error);
		return []; // Return empty array on failure
	}
}

export {
	fetchPlaylistVideoCounts,
	getAndCacheVideosForLevel
};