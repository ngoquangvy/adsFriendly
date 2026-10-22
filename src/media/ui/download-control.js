import { getMediaDownloadAvailability } from "../download-job-contract.js";
import {
  getMediaAudioTrackOptions,
  getMediaDownloadEstimate,
  getMediaDownloadProfiles,
  getMediaVideoQualityOptions,
} from "../download-options.js";
import { formatBytes } from "../download-job-view.js";
import { hasYouTubeProviderPendingTracks } from "../adaptive-track-policy.js";
import { createDownloadHistoryCard } from "./download-history.js";
import { formatDirectAudioEstimate } from "../audio-view.js";

export function createMediaDownloadControl(
  item,
  downloadItem,
  tab,
  helper,
  {
    settings = null,
    qualityPreflightCache: youtubeQualityPreflightCache = new Map(),
    setupMediaHelper,
    onStarted: updateMediaJobs = async () => {},
    initialSelection = {},
    onSelectionChange = () => {},
    onOutputChange = () => {},
    onController = () => {},
    openManager = null,
  } = {},
) {
  let preferred = initialSelection;
  let historyJob = null;
  let historyExact = true;
  let historyKey = null;
  let editing = false;
  let submitting = false;
  const availability = getMediaDownloadAvailability(downloadItem);
  const control = document.createElement("div");
  control.className = "media-download-control";

  const profiles = getMediaDownloadProfiles(downloadItem, {
    canSelectContainer: helper.canSelectContainer === true,
  });
  const profileSelect = document.createElement("select");
  profileSelect.className = "media-download-profile";
  profileSelect.title = "Output format";
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    option.title = profile.description;
    profileSelect.append(option);
  }
  profileSelect.disabled = !availability.supported || profiles.length < 2;
  if (profiles.some((profile) => profile.id === preferred.profileId))
    profileSelect.value = preferred.profileId;
  const qualityOptions = getMediaVideoQualityOptions(downloadItem);
  const needsYouTubePreflight =
    downloadItem.kind === "adaptive" &&
    downloadItem.provider === "youtube" &&
    hasYouTubeProviderPendingTracks(downloadItem);
  const preflightKey = needsYouTubePreflight
    ? `${tab?.id || ""}|${downloadItem.id}`
    : null;
  let qualityVerdict = preflightKey
    ? youtubeQualityPreflightCache.get(preflightKey) || null
    : null;
  const qualitySelect = document.createElement("select");
  qualitySelect.className = "media-download-profile";
  qualitySelect.title = "Video quality";
  const audioTrackOptions = getMediaAudioTrackOptions(downloadItem);
  const audioSelect = document.createElement("select");
  audioSelect.className = "media-download-profile";
  audioSelect.title = "Audio track";
  const renderAudioOptions = () => {
    audioSelect.replaceChildren();
    const availableById = new Map(
      (qualityVerdict?.audioOptions || []).map((option) => [option.id, option]),
    );
    const visibleAudio = needsYouTubePreflight
      ? audioTrackOptions.filter((option) => availableById.has(option.id))
      : audioTrackOptions;
    if (!visibleAudio.length) {
      const option = document.createElement("option");
      option.textContent =
        needsYouTubePreflight && !qualityVerdict
          ? "Audio · Checking availability…"
          : "Audio · unavailable";
      option.disabled = true;
      audioSelect.append(option);
      audioSelect.disabled = true;
      return;
    }
    for (const audio of visibleAudio) {
      const option = document.createElement("option");
      option.value = audio.id;
      option.textContent = audio.label;
      const verdict = availableById.get(audio.id);
      option.title = verdict?.sourceLabel || audio.label;
      audioSelect.append(option);
    }
    audioSelect.disabled = !availability.supported || visibleAudio.length < 2;
    const previous = [...audioSelect.options].find(
      (option) => option.textContent === preferred.audioLabel,
    );
    if (previous) audioSelect.value = previous.value;
  };
  const renderQualityOptions = () => {
    qualitySelect.replaceChildren();
    if (profileSelect.value === "audio-ogg") {
      const option = document.createElement("option");
      option.textContent = "Audio only · OGG";
      option.title = "The selected audio track will be converted to OGG.";
      option.disabled = true;
      qualitySelect.append(option);
      qualitySelect.disabled = true;
      return;
    }
    if (
      needsYouTubePreflight &&
      (helper.status !== "ready" ||
        helper.canResolveYouTubeQualityPreflight !== true)
    ) {
      const option = document.createElement("option");
      option.textContent =
        helper.status === "ready"
          ? "Quality · update helper to check"
          : "Quality · helper required";
      option.title =
        helper.status === "ready"
          ? "Update Media Helper to verify downloadable YouTube qualities."
          : "Connect Media Helper to verify downloadable YouTube qualities.";
      option.disabled = true;
      qualitySelect.append(option);
      qualitySelect.disabled = true;
      return;
    }
    if (needsYouTubePreflight && !qualityVerdict) {
      const option = document.createElement("option");
      option.textContent = "Quality · Checking availability…";
      option.disabled = true;
      qualitySelect.append(option);
      qualitySelect.disabled = true;
      return;
    }
    if (needsYouTubePreflight && qualityVerdict?.status !== "ready") {
      const option = document.createElement("option");
      option.textContent = "Quality · unavailable";
      option.title =
        qualityVerdict?.reason || "No downloadable quality was found.";
      option.disabled = true;
      qualitySelect.append(option);
      qualitySelect.disabled = true;
      return;
    }
    const automaticQuality = document.createElement("option");
    automaticQuality.value = "";
    automaticQuality.textContent = needsYouTubePreflight
      ? "Quality · Auto (best available)"
      : "Quality · Auto (best)";
    qualitySelect.append(automaticQuality);
    const availableById = new Map(
      (qualityVerdict?.videoOptions || []).map((option) => [option.id, option]),
    );
    const visibleQualities = needsYouTubePreflight
      ? qualityOptions.filter((quality) => availableById.has(quality.id))
      : qualityOptions;
    const qualityGroups = new Map();
    for (const quality of visibleQualities) {
      const option = document.createElement("option");
      option.value = quality.id;
      const verdict = availableById.get(quality.id);
      option.textContent =
        quality.optionLabel || quality.label || "Source quality";
      if (
        quality.groupLabel &&
        !option.textContent.startsWith(quality.groupLabel)
      )
        option.textContent = `${quality.groupLabel} · ${option.textContent}`;
      if (verdict?.availability === "equivalent") {
        option.textContent += " · compatible equivalent";
        option.title = `Provider source: ${verdict.sourceLabel}`;
      } else if (verdict?.sourceLabel) {
        option.title = `Provider source: ${verdict.sourceLabel}`;
      }
      const groupLabel = quality.groupLabel || "Source quality";
      let group = qualityGroups.get(groupLabel);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = groupLabel;
        qualityGroups.set(groupLabel, group);
        qualitySelect.append(group);
      }
      group.append(option);
    }
    qualitySelect.disabled =
      !availability.supported || !visibleQualities.length;
    const previous = [...qualitySelect.options].find(
      (option) => qualityKey(option) === preferred.qualityLabel,
    );
    if (previous) qualitySelect.value = previous.value;
  };
  renderAudioOptions();
  renderQualityOptions();
  const estimateLabel = document.createElement("span");
  estimateLabel.className = "media-download-estimate";
  const updateEstimate = () => {
    const estimate = getMediaDownloadEstimate(downloadItem, item, {
      videoTrackId: qualitySelect.value || null,
      audioTrackId: audioSelect.value || null,
      audioOnly: profileSelect.value === "audio-ogg",
    });
    const directAudio =
      downloadItem.kind === "direct" && downloadItem.mediaType === "audio";
    estimateLabel.textContent = directAudio
      ? formatDirectAudioEstimate({
          ...downloadItem,
          duration: estimate.duration,
          contentLength: downloadItem.contentLength ?? item.contentLength,
        })
      : formatDownloadEstimate(estimate);
    estimateLabel.title = directAudio
      ? "Observed total file size; average bitrate is estimated from size and duration, including container overhead."
      : formatDownloadEstimateTitle(estimate);
  };
  const syncDownloadButton = () => {
    const presentation = downloadButtonPresentation(
      availability,
      helper,
      downloadItem,
    );
    let next = presentation;
    if (
      needsYouTubePreflight &&
      helper.status === "ready" &&
      helper.canResolveYouTubeQualityPreflight !== true
    ) {
      next = {
        disabled: true,
        label: "Update helper",
        title:
          "Update Media Helper to verify YouTube qualities before downloading.",
      };
    } else if (
      needsYouTubePreflight &&
      helper.status === "ready" &&
      helper.canResolveYouTubeQualityPreflight === true
    ) {
      if (!qualityVerdict) {
        next = {
          disabled: true,
          label: "Checking…",
          title: "Checking which YouTube qualities are downloadable.",
        };
      } else if (
        profileSelect.value !== "audio-ogg" &&
        qualityVerdict.status !== "ready"
      ) {
        next = {
          disabled: true,
          label: "Unavailable",
          title:
            qualityVerdict.reason ||
            "No YouTube quality is available through the current provider profile.",
        };
      } else if (
        profileSelect.value !== "audio-ogg" &&
        qualityVerdict.videoOptions.length === 0
      ) {
        next = {
          disabled: true,
          label: "Unavailable",
          title: "No downloadable YouTube video quality is available.",
        };
      } else if (
        profileSelect.value !== "audio-ogg" &&
        qualitySelect.value &&
        !qualityVerdict.videoOptions.some(
          (option) => option.id === qualitySelect.value,
        )
      ) {
        next = {
          disabled: true,
          label: "Unavailable",
          title: "The selected YouTube quality is not downloadable.",
        };
      } else if (
        profileSelect.value === "audio-ogg" &&
        !qualityVerdict.audioOptions?.some(
          (option) => option.id === audioSelect.value,
        )
      ) {
        next = {
          disabled: true,
          label: "Unavailable",
          title: "No downloadable YouTube audio track is available.",
        };
      }
    }
    button.disabled = next.disabled;
    button.textContent = next.label;
    button.title = next.title;
  };
  qualitySelect.addEventListener("change", () => {
    rememberSelection();
    updateEstimate();
    syncDownloadButton();
  });
  audioSelect.addEventListener("change", () => {
    rememberSelection();
    updateEstimate();
    syncDownloadButton();
  });
  profileSelect.addEventListener("change", () => {
    preferred = { ...preferred, profileId: profileSelect.value };
    renderQualityOptions();
    rememberSelection();
    updateEstimate();
    syncDownloadButton();
  });
  updateEstimate();
  function rememberSelection() {
    preferred = {
      profileId: profileSelect.value,
      qualityLabel: qualityKey(qualitySelect.selectedOptions[0]),
      audioLabel: audioSelect.selectedOptions[0]?.textContent || "",
    };
    onSelectionChange(preferred);
    historyJob = null;
    historyKey = null;
    editing = false;
    renderHistory();
    onOutputChange(getOutput());
  }
  for (const select of [profileSelect, qualitySelect, audioSelect])
    select.setAttribute("aria-label", select.title);
  function qualityKey(option) {
    return option
      ? `${option.parentElement?.label || ""}|${option.textContent}`
      : "";
  }
  const button = document.createElement("button");
  button.className = "media-download";
  const presentation = downloadButtonPresentation(
    availability,
    helper,
    downloadItem,
  );
  button.disabled = presentation.disabled;
  button.textContent = presentation.label;
  button.title = presentation.title;
  const getOutput = () => ({
    profileId: profileSelect.value || profiles[0]?.id,
    videoTrackId:
      profileSelect.value === "audio-ogg" ? null : qualitySelect.value || null,
    audioTrackId: audioSelect.value || qualityVerdict?.audioOption?.id || null,
    allowEquivalentVideo:
      qualityVerdict?.videoOptions?.find(
        (option) => option.id === qualitySelect.value,
      )?.availability === "equivalent" ||
      (profileSelect.value !== "audio-ogg" &&
        !qualitySelect.value &&
        needsYouTubePreflight),
  });
  async function startDownload(event, repeatOf = null) {
    if (!event.isTrusted) return;
    if (submitting) return;
    submitting = true;
    button.disabled = true;
    if (helper.status !== "ready" || !helperCanDownload(downloadItem, helper)) {
      try {
        await setupMediaHelper(button, helper);
      } finally {
        submitting = false;
      }
      return;
    }
    button.textContent = "Starting…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CREATE_MEDIA_DOWNLOAD_JOB",
        tabId: tab.id,
        mediaId: downloadItem.id,
        connections: settings?.mediaDownloadConnections ?? 8,
        output: getOutput(),
        repeatOf,
      });
      if (
        ["already_downloaded", "already_downloading"].includes(response?.status)
      ) {
        editing = false;
        historyKey = null;
        setHistory({ exactJob: response.job, latestJob: response.job });
        return;
      }
      if (response?.status !== "started")
        throw new Error(
          response?.reason ||
            response?.error ||
            "Could not start the helper download job.",
        );
      button.textContent = "Started";
      historyJob = null;
      historyKey = null;
      editing = false;
      renderHistory();
      await updateMediaJobs();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry";
      button.title = error?.message || String(error);
    } finally {
      submitting = false;
    }
  }
  button.addEventListener("click", (event) => void startDownload(event));
  if (availability.supported) control.append(estimateLabel);
  if (
    availability.supported &&
    downloadItem.kind === "adaptive" &&
    profiles.some((profile) => profile.id === "video-mp4")
  )
    control.append(qualitySelect);
  if (availability.supported && profiles.length) control.append(profileSelect);
  if (
    availability.supported &&
    downloadItem.kind === "adaptive" &&
    audioTrackOptions.length
  )
    control.append(audioSelect);
  control.append(button);
  const history = document.createElement("div");
  history.hidden = true;
  control.append(history);
  async function outputAction(type) {
    const response = await chrome.runtime.sendMessage({
      type,
      jobId: historyJob.id,
    });
    if (response?.status !== "opened" && response?.status !== "revealed")
      throw new Error(
        response?.error ||
          response?.reason ||
          "Could not open saved file. It may have moved.",
      );
  }
  function renderHistory() {
    const card =
      !editing && historyJob
        ? createDownloadHistoryCard(historyJob, {
            exact: historyExact,
            open: () => outputAction("OPEN_MEDIA_DOWNLOAD_OUTPUT"),
            folder: () => outputAction("REVEAL_MEDIA_DOWNLOAD_OUTPUT"),
            repeat: (event) => startDownload(event, historyJob.id),
            options: historyExact
              ? () => {
                  editing = true;
                  renderHistory();
                  syncDownloadButton();
                }
              : null,
            manager: openManager,
          })
        : null;
    history.replaceChildren(...(card ? [card] : []));
    history.hidden = !card;
    for (const child of control.children)
      if (child !== history) child.hidden = Boolean(card && historyExact);
  }
  function setHistory(context) {
    if (submitting && !context?.exactJob) return;
    const job = context?.exactJob || context?.latestJob || null;
    const exact = Boolean(context?.exactJob);
    const key = job
      ? `${job.id}|${job.status}|${job.fileStatus}|${exact}`
      : "none";
    if (key === historyKey) return; // No DOM replacement/focus loss on every poll.
    const old = historyJob;
    historyKey = key;
    historyJob = job;
    historyExact = exact;
    if (old?.id !== job?.id || old?.status !== job?.status) editing = false;
    renderHistory();
    if ((!job || !exact) && !submitting) syncDownloadButton();
  }
  onController({ getOutput, setHistory });
  if (
    needsYouTubePreflight &&
    helper.status === "ready" &&
    helper.canResolveYouTubeQualityPreflight === true
  ) {
    if (!qualityVerdict) {
      const request = chrome.runtime
        .sendMessage({
          type: "PREFLIGHT_MEDIA_DOWNLOAD_QUALITIES",
          tabId: tab?.id,
          mediaId: downloadItem.id,
        })
        .then((response) => {
          qualityVerdict = normalizePopupYouTubePreflight(response);
          if (preflightKey && qualityVerdict)
            youtubeQualityPreflightCache.set(preflightKey, qualityVerdict);
          if (!control.isConnected) return;
          renderQualityOptions();
          renderAudioOptions();
          syncDownloadButton();
          updateEstimate();
          onOutputChange(getOutput());
        })
        .catch((error) => {
          qualityVerdict = {
            status: "unavailable",
            videoOptions: [],
            reason: error?.message || String(error),
          };
          if (control.isConnected) {
            renderQualityOptions();
            renderAudioOptions();
            syncDownloadButton();
          }
        });
      void request;
    }
    syncDownloadButton();
  }
  onOutputChange(getOutput());
  return control;
}

function normalizePopupYouTubePreflight(response) {
  const result = response?.result || response;
  const options = Array.isArray(result?.videoOptions)
    ? result.videoOptions.filter(
        (option) =>
          option &&
          typeof option.id === "string" &&
          ["exact", "equivalent"].includes(option.availability),
      )
    : [];
  return {
    status: result?.status === "ready" ? "ready" : "unavailable",
    videoOptions: options,
    audioOption:
      result?.audioOption && typeof result.audioOption.id === "string"
        ? {
            id: result.audioOption.id,
            sourceLabel:
              typeof result.audioOption.sourceLabel === "string"
                ? result.audioOption.sourceLabel
                : "Audio source",
          }
        : null,
    audioOptions: Array.isArray(result?.audioOptions)
      ? result.audioOptions.filter(
          (option) => option && typeof option.id === "string",
        )
      : result?.audioOption && typeof result.audioOption.id === "string"
        ? [result.audioOption]
        : [],
    reason: typeof result?.reason === "string" ? result.reason : null,
  };
}

function formatDownloadEstimate(estimate) {
  const quality = estimate.resolution?.height
    ? `${estimate.resolution.height}p`
    : "Source quality";
  const size = estimate.estimatedBytes
    ? `${estimate.basis === "source_headers" ? "" : "Est. "}${formatBytes(
        estimate.estimatedBytes,
      )}`
    : "Size unavailable";
  return `${quality} · ${size}`;
}

function formatDownloadEstimateTitle(estimate) {
  if (!estimate.estimatedBytes) {
    return "The manifest does not expose enough bitrate data to estimate size before download.";
  }
  if (estimate.basis === "source_headers")
    return "Total file size from the media response headers.";
  return "Estimated from manifest bitrate and duration. Final file size may differ.";
}

export function downloadButtonPresentation(availability, helper, item) {
  if (!availability.supported) {
    return {
      disabled: true,
      label: downloadUnavailableLabel(availability.reason),
      title: availability.reason,
    };
  }
  if (helper.status === "permission_required") {
    return {
      disabled: false,
      label: "Set up",
      title: "Enable the optional Media Helper connection to download media.",
    };
  }
  if (helper.status === "not_installed") {
    return {
      disabled: false,
      label: "Install",
      title: "Media Helper is required for media downloads.",
    };
  }
  if (helper.status === "ready" && !helperCanDownload(item, helper)) {
    return {
      disabled: true,
      label: "Helper update",
      title: `The installed Media Helper does not support ${item.mediaType === "audio" && item.kind === "direct" ? "direct audio" : item.kind.toUpperCase()} downloads yet.`,
    };
  }
  if (helper.status !== "ready") {
    return {
      disabled: false,
      label: "Retry",
      title: helper.error || "Could not connect to Media Helper.",
    };
  }
  return {
    disabled: false,
    label: "Download",
    title: "Download with AdsFriendly Media Helper.",
  };
}

function helperCanDownload(item, helper) {
  if (item.kind === "direct")
    return (
      helper.canDownloadDirect === true &&
      (item.mediaType !== "audio" || helper.canDownloadDirectAudio === true)
    );
  if (item.kind === "hls")
    return (
      helper.canDownloadHls === true &&
      (item.probeSource !== "decrypted_blob" ||
        helper.canDownloadDecryptedHls === true)
    );
  if (item.kind === "adaptive")
    return (
      helper.canDownloadAdaptive === true &&
      (item.acquisitionProfile !== "youtube_player_js_challenge" ||
        helper.canResolveYouTubePlayerJs === true) &&
      (!hasYouTubeProviderPendingTracks(item) ||
        helper.canResolveYouTubeProviderFormats === true)
    );
  return helper.canDownloadDash === true;
}

function downloadUnavailableLabel(reason = "") {
  if (reason.includes("DRM") || reason.includes("Playback only"))
    return "Playback only";
  if (reason.includes("Live")) return "Live";
  if (reason.includes("Encrypted")) return "Encrypted";
  if (
    reason.includes("waiting") ||
    reason.includes("not exposed") ||
    reason.includes("player-resolved")
  )
    return "Watching";
  if (reason.includes("no media")) return "No media";
  return "Unavailable";
}
