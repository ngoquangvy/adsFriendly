/**
 * HLS Inspector v1.0 — Media Stream Structure Analyzer
 * 
 * Module chuyên biệt giải phẫu cấu trúc file M3U8 (HLS Protocol).
 * Hoạt động như lõi (Core) của một Download Manager: Phân tích toàn bộ
 * cấu trúc luồng phát, tách riêng từng Block (Content vs Ads),
 * trích xuất thông tin kỹ thuật (Resolution, Bandwidth, Duration).
 * 
 * Nhiệm vụ DUY NHẤT: Nhận vào Text → Trả ra Cây Cấu Trúc (Media Tree).
 * KHÔNG chặn, KHÔNG quyết định, KHÔNG dispatch event.
 */

const AD_DOMAIN_HINTS = [
    'doubleclick', 'googlesyndication', 'googleads', 'adnxs', 'adsrvr',
    'moatads', 'serving-sys', 'pubmatic', 'openx', 'rubiconproject',
    'tsyndicate', 'adsterra', 'propellerads', 'trafficjunky',
    'syndication', 'adservice', 'pagead', 'gampad'
];

/**
 * Resolve relative URLs thành absolute URLs
 * (Giống cách Download Manager xử lý link tương đối)
 */
function resolveUrl(segmentUrl, baseUrl) {
    if (!segmentUrl) return '';
    // Already absolute
    if (segmentUrl.startsWith('http://') || segmentUrl.startsWith('https://')) {
        return segmentUrl;
    }
    try {
        return new URL(segmentUrl, baseUrl).href;
    } catch {
        return segmentUrl;
    }
}

/**
 * Trích xuất hostname từ URL
 */
function extractHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Kiểm tra URL có dấu hiệu quảng cáo dựa trên domain
 */
function isDomainSuspicious(hostname) {
    if (!hostname) return false;
    return AD_DOMAIN_HINTS.some(hint => hostname.includes(hint));
}

/**
 * Kiểm tra URL path có chứa hint quảng cáo
 */
function hasAdPathHint(url) {
    if (!url || typeof url !== 'string') return false;
    return /\/ad[s_\-]?[\/\d]|preroll|midroll|postroll|vast|vpaid/i.test(url);
}

const HLSInspector = {

    /**
     * Phân tích Master Playlist (chứa các link chọn độ phân giải)
     * Trả về danh sách các Variant (480p, 720p, 1080p...)
     */
    parseMasterPlaylist(text, sourceUrl) {
        const lines = text.split('\n').map(l => l.trim());
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                // Trích xuất thông số kỹ thuật
                const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
                const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                const codecsMatch = line.match(/CODECS="([^"]+)"/);

                // Dòng tiếp theo là URL của Media Playlist
                const nextLine = lines[i + 1];
                if (nextLine && !nextLine.startsWith('#')) {
                    const resolvedUrl = resolveUrl(nextLine, sourceUrl);
                    variants.push({
                        url: resolvedUrl,
                        bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : null,
                        resolution: resolutionMatch ? resolutionMatch[1] : null,
                        codecs: codecsMatch ? codecsMatch[1] : null,
                        hostname: extractHostname(resolvedUrl)
                    });
                    i++; // Skip URL line
                }
            }
        }

        return {
            playlist_type: 'master',
            variants_count: variants.length,
            variants
        };
    },

    /**
     * Phân tích Media Playlist (chứa các file .ts trực tiếp)
     * Trả về Cây Cấu Trúc với các Block tách riêng
     * 
     * Đây chính là thuật toán cốt lõi (Download Manager Core):
     * - Chia file m3u8 thành các Block dựa trên thẻ DISCONTINUITY
     * - Mỗi Block chứa danh sách các Segment (.ts) cùng timing
     * - Phát hiện Block quảng cáo dựa trên sự thay đổi Domain, Bandwidth, Duration bất thường
     */
    parseMediaPlaylist(text, sourceUrl) {
        const lines = text.split('\n').map(l => l.trim());
        const blocks = [];
        let currentBlock = this._createEmptyBlock(0);
        let accumulatedTime = 0;
        let pendingDuration = null;
        let globalMediaSequence = 0;
        let segmentIndex = 0;

        // Trích xuất metadata toàn cục
        const targetDurationMatch = text.match(/#EXT-X-TARGETDURATION:(\d+)/);
        const mediaSequenceMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
        const playlistTypeMatch = text.match(/#EXT-X-PLAYLIST-TYPE:(\w+)/);

        if (mediaSequenceMatch) globalMediaSequence = parseInt(mediaSequenceMatch[1]);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Bắt gặp thẻ đứt gãy → Kết thúc Block hiện tại, tạo Block mới
            if (line === '#EXT-X-DISCONTINUITY') {
                if (currentBlock.segments.length > 0) {
                    this._finalizeBlock(currentBlock, sourceUrl);
                    blocks.push(currentBlock);
                }
                currentBlock = this._createEmptyBlock(blocks.length);
                currentBlock.preceded_by_discontinuity = true;
                continue;
            }

            // Bắt gặp thẻ CUE-OUT → Đánh dấu Block hiện tại là Ad
            if (line.startsWith('#EXT-X-CUE-OUT')) {
                currentBlock.has_cue_out = true;
                const durationMatch = line.match(/DURATION=([\d.]+)/);
                if (durationMatch) currentBlock.cue_out_duration = parseFloat(durationMatch[1]);
                continue;
            }

            if (line.startsWith('#EXT-X-CUE-IN')) {
                currentBlock.has_cue_in = true;
                continue;
            }

            if (line.startsWith('#EXT-X-SCTE35')) {
                currentBlock.has_scte35 = true;
                continue;
            }

            // Bắt gặp thẻ Duration → Lưu tạm để gắn cho Segment tiếp theo
            if (line.startsWith('#EXTINF:')) {
                const match = line.match(/#EXTINF:([\d.]+)/);
                pendingDuration = match ? parseFloat(match[1]) : 0;
                continue;
            }

            // Dòng URL (không phải thẻ #) → Đây là file .ts
            if (!line.startsWith('#') && line.length > 0 && pendingDuration !== null) {
                const resolvedUrl = resolveUrl(line, sourceUrl);
                const hostname = extractHostname(resolvedUrl);

                currentBlock.segments.push({
                    index: segmentIndex,
                    sequence: globalMediaSequence + segmentIndex,
                    url: resolvedUrl,
                    hostname,
                    duration: pendingDuration,
                    time_start: accumulatedTime,
                    time_end: accumulatedTime + pendingDuration,
                    is_domain_suspicious: isDomainSuspicious(hostname),
                    has_ad_path_hint: hasAdPathHint(resolvedUrl)
                });

                accumulatedTime += pendingDuration;
                segmentIndex++;
                pendingDuration = null;
            }
        }

        // Finalize Block cuối cùng
        if (currentBlock.segments.length > 0) {
            this._finalizeBlock(currentBlock, sourceUrl);
            blocks.push(currentBlock);
        }

        // Phân tích so sánh chéo giữa các Block (Cross-Block Analysis)
        this._crossBlockAnalysis(blocks);

        return {
            playlist_type: text.includes('#EXT-X-ENDLIST') ? 'vod' : 'live',
            target_duration: targetDurationMatch ? parseInt(targetDurationMatch[1]) : null,
            media_sequence: globalMediaSequence,
            content_type: playlistTypeMatch ? playlistTypeMatch[1] : null,
            total_duration: accumulatedTime,
            total_segments: segmentIndex,
            blocks_count: blocks.length,
            blocks
        };
    },

    /**
     * Điểm vào chính (Main Entry Point)
     * Nhận text m3u8 → Tự động phân loại Master/Media → Trả về Cây Cấu trúc
     */
    parse(text, sourceUrl) {
        if (!text || typeof text !== 'string' || text.length < 10) return null;
        if (!text.includes('#EXTM3U')) return null;

        const isMaster = text.includes('#EXT-X-STREAM-INF:');

        if (isMaster) {
            return {
                is_parsed: true,
                ...this.parseMasterPlaylist(text, sourceUrl)
            };
        } else {
            return {
                is_parsed: true,
                ...this.parseMediaPlaylist(text, sourceUrl)
            };
        }
    },

    /**
     * Tra cứu: URL có thuộc Block nào không? (Lookup Table)
     * Được gọi bởi Radar khi tóm được request tải file .ts
     */
    lookupSegment(url, hlsStructure) {
        if (!hlsStructure || !hlsStructure.blocks) return null;

        for (const block of hlsStructure.blocks) {
            for (const seg of block.segments) {
                if (seg.url === url) {
                    return {
                        belongs_to_block_id: block.block_id,
                        structural_role: block.is_ad_suspect ? 'ad_suspect' : 'content',
                        block_duration: block.duration,
                        sequence_index: seg.index,
                        segment_time_start: seg.time_start,
                        segment_time_end: seg.time_end,
                        suspect_reasons: block.suspect_reasons || []
                    };
                }
            }
        }
        return null;
    },

    // ─── PRIVATE HELPERS ────────────────────────────────────────

    _createEmptyBlock(index) {
        return {
            block_id: `blk_${String(index).padStart(2, '0')}`,
            segments: [],
            preceded_by_discontinuity: false,
            has_cue_out: false,
            has_cue_in: false,
            has_scte35: false,
            cue_out_duration: null,
            duration: 0,
            is_ad_suspect: false,
            suspect_reasons: []
        };
    },

    _finalizeBlock(block, sourceUrl) {
        // Tính tổng thời gian
        block.duration = block.segments.reduce((sum, s) => sum + s.duration, 0);
        block.segments_count = block.segments.length;

        // Trích xuất Base URL Pattern
        const hostnames = [...new Set(block.segments.map(s => s.hostname).filter(Boolean))];
        block.base_hostnames = hostnames;

        // Phân tích dấu hiệu quảng cáo cấu trúc
        const reasons = [];

        // 1. Block bị cô lập bởi thẻ đứt gãy
        if (block.preceded_by_discontinuity) reasons.push('discontinuity_separated');

        // 2. Block có thẻ CUE-OUT (Dấu hiệu chuẩn SCTE-35)
        if (block.has_cue_out) reasons.push('cue_out_marker');
        if (block.has_scte35) reasons.push('scte35_marker');

        // 3. Domain của segment khác với domain của playlist nguồn
        const sourceHostname = extractHostname(sourceUrl);
        if (hostnames.length > 0 && sourceHostname) {
            const allForeign = hostnames.every(h => h !== sourceHostname);
            if (allForeign) reasons.push('foreign_domain');
        }

        // 4. Domain nằm trong danh sách domain quảng cáo
        const hasSuspiciousDomain = hostnames.some(h => isDomainSuspicious(h));
        if (hasSuspiciousDomain) reasons.push('ad_domain_match');

        // 5. Có URL path chứa hint quảng cáo
        const hasAdPath = block.segments.some(s => s.has_ad_path_hint);
        if (hasAdPath) reasons.push('ad_path_hint');

        block.suspect_reasons = reasons;
        block.is_ad_suspect = reasons.length > 0;

        // Gỡ bỏ full URL list khỏi output (giữ nhẹ Record)
        // Chỉ giữ lại danh sách URL rút gọn
        block.segment_urls = block.segments.map(s => s.url);
        // Giữ nguyên segments array đầy đủ cho lookupSegment()
    },

    /**
     * Phân tích so sánh chéo giữa các Block
     * - Block quá ngắn so với Block lớn nhất → Nghi ngờ
     * - Block có Domain khác biệt → Nghi ngờ
     */
    _crossBlockAnalysis(blocks) {
        if (blocks.length < 2) return;

        // Tìm Block dài nhất (Content chính)
        const longestBlock = blocks.reduce((a, b) => a.duration > b.duration ? a : b);
        const contentHostnames = longestBlock.base_hostnames || [];

        for (const block of blocks) {
            if (block === longestBlock) continue;

            // Block ngắn bất thường (< 5% thời lượng của Block chính)
            if (longestBlock.duration > 0 && block.duration / longestBlock.duration < 0.05) {
                if (!block.suspect_reasons.includes('short_duration_ratio')) {
                    block.suspect_reasons.push('short_duration_ratio');
                    block.is_ad_suspect = true;
                }
            }

            // Block dùng hostname khác với Content chính
            if (contentHostnames.length > 0 && block.base_hostnames.length > 0) {
                const noOverlap = block.base_hostnames.every(h => !contentHostnames.includes(h));
                if (noOverlap && !block.suspect_reasons.includes('foreign_domain')) {
                    block.suspect_reasons.push('cross_block_domain_mismatch');
                    block.is_ad_suspect = true;
                }
            }
        }
    }
};

// Export cho cả Main World (Browser) và Node.js (Testing)
if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.modules = window.Engine.modules || {};
    window.Engine.modules.HLSInspector = HLSInspector;
}

if (typeof module !== 'undefined') {
    module.exports = HLSInspector;
}
