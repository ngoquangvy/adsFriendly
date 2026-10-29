import { readFile, writeFile } from "node:fs/promises";

// Deterministic default, with the same replacement identity as native custom profiles.
const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>com.vyngo.adsfriendly.dns</string>
<key>PayloadUUID</key><string>90A33F95-C766-4AAC-84DF-748FE49868D0</string>
<key>PayloadDisplayName</key><string>AdsFriendly DNS</string>
<key>PayloadDescription</key><string>DNS queries are sent to dns.adguard-dns.com. Domain filtering depends on that resolver. This profile cannot block URL paths and does not install a certificate or VPN.</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.dnsSettings.managed</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>com.vyngo.adsfriendly.dns.settings</string>
<key>PayloadUUID</key><string>7E321C37-1F89-4FA7-A71B-D9F0A0C505E2</string>
<key>PayloadDisplayName</key><string>AdsFriendly DNS — dns.adguard-dns.com</string>
<key>DNSSettings</key><dict>
<key>DNSProtocol</key><string>HTTPS</string>
<key>ServerURL</key><string>https://dns.adguard-dns.com/dns-query</string>
</dict></dict></array>
</dict></plist>
`;
const url = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS/Resources/AdsFriendly-Default-DNS.mobileconfig",
  import.meta.url,
);
if (process.argv.includes("--check")) {
  if ((await readFile(url, "utf8")).replace(/\r\n/g, "\n") !== profile)
    throw Error(
      "Stale bundled DNS profile. Run node scripts/build-ios-dns-profile.mjs.",
    );
} else await writeFile(url, profile);
console.log(
  "Bundled default DNS profile " +
    (process.argv.includes("--check") ? "verified." : "generated."),
);
