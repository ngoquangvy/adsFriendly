/**
 * Event Classifier
 * Role: Enrich raw events with semantic context
 * Responsibilities:
 *   - Classify URLs (media, tracking, ad, etc.)
 *   - Extract transport signals
 *   - Determine resource class & subclass
 *   - Handle malformed URLs gracefully
 * NOT in radar - happens at engine layer
 */

const EventClassifier = {
    /**
     * Check if URL is synthetic (malformed marker from radar)
     * ✅ Matches pattern created in xhr_radar.js: radar://unknown/${source}/${errorType}/${timestamp}
     */
    isSynthetic(url) {
        return typeof url === 'string' && url.startsWith('radar://');
    },

    /**
     * Enrich event with semantic context
     */
    classify(event) {
        const url = event.url || '';
        
        // ✅ GRACEFUL HANDLING: Malformed URLs
        if (this.isSynthetic(url) || event.malformed) {
            return {
                resourceClass: 'unknown_malformed',
                subClass: {
                    isError: true,
                    isMalformed: true,
                    hasExtractionError: !!event.extractionError
                },
                transport: {},
                context: {
                    isMediaSegment: false,
                    isVideoStream: false,
                    isTracking: false,
                    isAdRequest: false
                }
            };
        }

        // ✅ MEDIA ANALYSIS (HLS/DASH/Stream segments)
        const isMediaSegment =
            url.includes('videoplayback') ||
            url.includes('range=') ||
            /\.(m3u8|mpd|m4s|ts)($|\?)/i.test(url);

        const isVideoStream = url.includes('videoplayback');
        const isTracking = url.includes('ptracking') || event.type === 'beacon';
        const isAdRequest = url.includes('pagead');

        // ✅ TRANSPORT SIGNALS
        const isVideoCDN = /googlevideo\.com|vid\.|cdn|stream/i.test(url);

        // ✅ SEMANTIC ROLES (PRIMARY CLASSIFICATION)
        let resourceClass = 'other_asset';
        if (isVideoStream || isVideoCDN || isMediaSegment) {
            resourceClass = 'video_stream';
        } else if (isTracking) {
            resourceClass = 'tracking_pixel';
        } else if (isAdRequest) {
            resourceClass = 'ad_service';
        }

        // ✅ SUB-CLASSIFICATION (FORENSIC BUCKETS)
        const subClass = {
            isAd: url.includes('pagead'),
            isCDNVideo: /googlevideo|cdn/.test(url),
            isAnalytics: url.includes('analytics')
        };

        // ✅ TRANSPORT DETAILS
        const transport = {
            isVideoCDN,
            hasRange: url.includes('range='),
            isChunked: /range=\d+-\d+/i.test(url)
        };

        return {
            resourceClass,
            subClass,
            transport,
            context: {
                isMediaSegment,
                isVideoStream,
                isTracking,
                isAdRequest
            }
        };
    },

    /**
     * Enrich full event (attach classification + context)
     */
    enrichEvent(event) {
        const classification = this.classify(event);

        return {
            ...event,
            resourceClass: classification.resourceClass,
            subClass: classification.subClass,
            transport: classification.transport,
            context: {
                ...event.context,
                ...classification.context,
                isVisible: document.visibilityState === 'visible',
                initiator: event.type
            }
        };
    }
};

if (typeof window !== 'undefined') {
    window.EventClassifier = EventClassifier;
}
