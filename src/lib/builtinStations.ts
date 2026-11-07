import type { Station } from "./stations";

/**
 * Built-in stations: always on everyone's globe, whether or not the Radio
 * Browser directory lists them. To add one, paste a station here (the
 * "Copy" button next to a station in "Add a station" gives you one ready to
 * paste), then push.
 *
 * Keep each id unique and starting with "builtin-" or "extra-".
 */
export const BUILTIN_STATIONS: Station[] = [
  {
    id: "extra-bbc-1xtra",
    name: "BBC Radio 1Xtra",
    // The BBC's international stream
    url: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/audio_syndication_low_sbr_v1/aks/bbc_1xtra.m3u8",
    homepage: "https://www.bbc.co.uk/1xtra",
    country: "United Kingdom",
    countryCode: "GB",
    state: "London",
    lat: 51.5185,
    lon: -0.1439,
    tags: ["hip hop", "rnb", "grime", "uk garage", "afrobeats", "dancehall", "drum and bass"],
    languages: ["english"],
    codec: "AAC",
    clicks: 0,
    votes: 0,
    family: "hiphop",
    hls: true,
  },
];
