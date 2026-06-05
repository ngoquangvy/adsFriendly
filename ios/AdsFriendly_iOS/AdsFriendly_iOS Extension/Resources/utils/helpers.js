// ============================================================
// helpers.js - Danh sách trắng và các hàm hỗ trợ dùng chung
// ============================================================

const Whitelist = [
  "google.com",
  "accounts.google.com",
  "github.com",
  "microsoft.com",
  "login.microsoftonline.com",
  "live.com",
  "apple.com",
  "facebook.com",
  "appleid.apple.com"
];

// Lấy namespace API phù hợp (Safari hỗ trợ cả 2)
const api = (typeof browser !== 'undefined') ? browser : chrome;

function isWhitelisted(url) {
  try {
    const targetUrl = new URL(url);
    const hostname = targetUrl.hostname;
    return Whitelist.some(domain => hostname === domain || hostname.endsWith("." + domain));
  } catch (e) {
    return false;
  }
}

function isCrossOrigin(url) {
  try {
    const currentOrigin = window.location.origin;
    const targetUrl = new URL(url, window.location.href);
    return currentOrigin !== targetUrl.origin;
  } catch (e) {
    return true;
  }
}

// So sánh tên miền gốc (root domain) giữa 2 URL
// Ví dụ: sub.example.com và www.example.com -> cùng root domain
function getRootDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    // Lấy 2 phần cuối cùng (ví dụ: example.com)
    return parts.slice(-2).join('.');
  } catch (e) {
    return '';
  }
}

function areSameSite(url1, url2) {
  return getRootDomain(url1) === getRootDomain(url2);
}
