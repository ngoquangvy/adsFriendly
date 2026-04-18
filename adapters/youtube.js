// adapters/youtube.js
/**
 * 🎮 YouTube Platform Adapter
 * Role: Site-specific selectors and behavioral logic for YouTube.
 */
const YouTubeAdapter = {
    SELECTORS: {
        PLAYER: '#movie_player',
        AD_BUTTON: '.ytp-ad-skip-button'
    }
};

if (typeof window !== 'undefined') {
    window.Adapters = window.Adapters || {};
    window.Adapters.YouTube = YouTubeAdapter;
}
