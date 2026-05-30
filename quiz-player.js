let timeUpdateInterval = null;

function getVideoElement() {
  return document.querySelector('video');
}

function getCurrentTimeMs() {
  const video = getVideoElement();
  if (!video) {
    return 0;
  }
  return Math.floor(video.currentTime * 1000);
}

function seekToMs(ms) {
  const video = getVideoElement();
  if (!video) {
    return;
  }
  video.currentTime = ms / 1000;
}

function pauseVideo() {
  getVideoElement()?.pause();
}

function playVideo() {
  getVideoElement()?.play();
}

function onTimeUpdate(callback, intervalMs = 250) {
  stopTimeUpdate();
  timeUpdateInterval = setInterval(callback, intervalMs);
}

function stopTimeUpdate() {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
  }
}
