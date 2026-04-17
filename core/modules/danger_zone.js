/**
 * AdsFriendly: Danger Zone Module
 * M3U8/HLS DangerZone map management and detection.
 */
window.AdsFriendlyDangerZone = {
    dangerZones: {}, // v3.2: Map of src -> [{start, end}]

    onAdMapDetected(data) {
        console.log(`%c[AdsFriendly Video] Applied Genome Map (${data.provider}):`, 'color: #8b5cf6; font-weight: bold;', data.zones);
        // We use the last reported URL as key (approximated for stream continuity)
        const videos = document.querySelectorAll('video');
        videos.forEach(v => {
            const src = v.currentSrc || v.src;
            if (src) {
                this.dangerZones[src] = data.zones;
            }
        });
        
        // Immediate trigger check
        videos.forEach(v => this.checkAndExecute(v));
    },

    getDangerZoneInfo(video) {
        const src = video.currentSrc || video.src;
        const time = video.currentTime;
        
        let zones = this.dangerZones[src];
        if (!zones) {
            // Fallback for Blob/MSE where URL might change: Use any available recent map for single-video apps
            const keys = Object.keys(this.dangerZones);
            if (keys.length > 0) zones = this.dangerZones[keys[keys.length - 1]];
        }
        
        if (!zones) return null;
        return zones.find(zone => time >= zone.start && time <= zone.end) || null;
    },

    isInDangerZone(video) {
        return !!this.getDangerZoneInfo(video);
    }
};
