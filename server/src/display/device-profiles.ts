// GENERATED FILE -- do not edit.
// Source: vendor/trmnl-framework/css/plugins.min.css (framework 3.2.0)
// Regenerate: node server/scripts/generate-device-profiles.mjs

export type FrameworkDeviceProfile = {
  /** Layout size in CSS pixels, from --screen-w/--screen-h. */
  width: number;
  height: number;
  /** The framework applies this itself via transform: scale(). */
  pixelRatio: number;
  /** Bits per pixel the panel can show; selects the screen--Nbit class. */
  colorDepth: number;
  /** width/height x pixelRatio: the size to screenshot at, rounded to whole pixels. */
  deviceWidth: number;
  deviceHeight: number;
};

export const FRAMEWORK_DEVICES = {
  amazon_kindle_2024: { width: 800, height: 480, pixelRatio: 1.75, colorDepth: 4, deviceWidth: 1400, deviceHeight: 840 },
  amazon_kindle_7: { width: 800, height: 600, pixelRatio: 1, colorDepth: 4, deviceWidth: 800, deviceHeight: 600 },
  amazon_kindle_oasis_2: { width: 800, height: 602, pixelRatio: 2.1, colorDepth: 4, deviceWidth: 1680, deviceHeight: 1264 },
  amazon_kindle_paperwhite_6th_gen: { width: 800, height: 592, pixelRatio: 1.28, colorDepth: 4, deviceWidth: 1024, deviceHeight: 758 },
  amazon_kindle_paperwhite_7th_gen: { width: 905, height: 670, pixelRatio: 1.6, colorDepth: 4, deviceWidth: 1448, deviceHeight: 1072 },
  amazon_kindle_paperwhite_signature_11th_gen: { width: 800, height: 600, pixelRatio: 2.06, colorDepth: 4, deviceWidth: 1648, deviceHeight: 1236 },
  amazon_kindle_scribe: { width: 992, height: 744, pixelRatio: 2.5, colorDepth: 4, deviceWidth: 2480, deviceHeight: 1860 },
  amazon_kindle_voyage: { width: 1034, height: 765, pixelRatio: 1.4008, colorDepth: 4, deviceWidth: 1448, deviceHeight: 1072 },
  avalue_epd_42s: { width: 1040, height: 780, pixelRatio: 2.7692, colorDepth: 4, deviceWidth: 2880, deviceHeight: 2160 },
  byod_custom: { width: 800, height: 480, pixelRatio: 1, colorDepth: 1, deviceWidth: 800, deviceHeight: 480 },
  ed133ut2: { width: 1040, height: 780, pixelRatio: 1.5385, colorDepth: 4, deviceWidth: 1600, deviceHeight: 1200 },
  frame: { width: 2560, height: 1440, pixelRatio: 1, colorDepth: 1, deviceWidth: 2560, deviceHeight: 1440 },
  generic_16_9: { width: 800, height: 450, pixelRatio: 2.4, colorDepth: 24, deviceWidth: 1920, deviceHeight: 1080 },
  inkplate_10: { width: 800, height: 550, pixelRatio: 1.5, colorDepth: 4, deviceWidth: 1200, deviceHeight: 825 },
  inkplate_13_spectra: { width: 800, height: 600, pixelRatio: 2, colorDepth: 1, deviceWidth: 1600, deviceHeight: 1200 },
  inkplate_5_2: { width: 1067, height: 600, pixelRatio: 1.1996, colorDepth: 4, deviceWidth: 1280, deviceHeight: 720 },
  inkplate_6_color: { width: 800, height: 597, pixelRatio: 0.75, colorDepth: 1, deviceWidth: 600, deviceHeight: 448 },
  inkplate_6_plus: { width: 1040, height: 770, pixelRatio: 0.9846, colorDepth: 4, deviceWidth: 1024, deviceHeight: 758 },
  inky_impression_13_3: { width: 800, height: 600, pixelRatio: 2, colorDepth: 1, deviceWidth: 1600, deviceHeight: 1200 },
  inky_impression_7_3: { width: 800, height: 480, pixelRatio: 1, colorDepth: 1, deviceWidth: 800, deviceHeight: 480 },
  kobo_aura_h2o_2: { width: 1040, height: 785, pixelRatio: 1.375, colorDepth: 4, deviceWidth: 1430, deviceHeight: 1079 },
  kobo_aura_hd: { width: 800, height: 600, pixelRatio: 1.8, colorDepth: 4, deviceWidth: 1440, deviceHeight: 1080 },
  kobo_aura_one: { width: 1040, height: 780, pixelRatio: 1.8, colorDepth: 4, deviceWidth: 1872, deviceHeight: 1404 },
  kobo_forma: { width: 1371, height: 1028, pixelRatio: 1.4004, colorDepth: 4, deviceWidth: 1920, deviceHeight: 1440 },
  kobo_glo: { width: 788, height: 591, pixelRatio: 1.2995, colorDepth: 4, deviceWidth: 1024, deviceHeight: 768 },
  kobo_libra_2: { width: 840, height: 632, pixelRatio: 2, colorDepth: 4, deviceWidth: 1680, deviceHeight: 1264 },
  kobo_sage: { width: 1371, height: 1028, pixelRatio: 1.4004, colorDepth: 4, deviceWidth: 1920, deviceHeight: 1440 },
  kobo_touch: { width: 800, height: 600, pixelRatio: 1, colorDepth: 4, deviceWidth: 800, deviceHeight: 600 },
  m5_paper_s3: { width: 960, height: 540, pixelRatio: 1, colorDepth: 4, deviceWidth: 960, deviceHeight: 540 },
  mac_classic: { width: 512, height: 342, pixelRatio: 1, colorDepth: 1, deviceWidth: 512, deviceHeight: 342 },
  meta_portal: { width: 1040, height: 650, pixelRatio: 1.2308, colorDepth: 24, deviceWidth: 1280, deviceHeight: 800 },
  nook_simple_touch: { width: 800, height: 600, pixelRatio: 1, colorDepth: 4, deviceWidth: 800, deviceHeight: 600 },
  og: { width: 800, height: 480, pixelRatio: 1, colorDepth: 1, deviceWidth: 800, deviceHeight: 480 },
  og_png: { width: 800, height: 480, pixelRatio: 1, colorDepth: 1, deviceWidth: 800, deviceHeight: 480 },
  ogv2: { width: 800, height: 480, pixelRatio: 1, colorDepth: 2, deviceWidth: 800, deviceHeight: 480 },
  onxy_boox_nova_air_c: { width: 1040, height: 780, pixelRatio: 1.8, colorDepth: 12, deviceWidth: 1872, deviceHeight: 1404 },
  onyx_boox_go_7: { width: 933, height: 702, pixelRatio: 1.8008, colorDepth: 4, deviceWidth: 1680, deviceHeight: 1264 },
  onyx_boox_poke_5: { width: 800, height: 1081, pixelRatio: 1.34, colorDepth: 4, deviceWidth: 1072, deviceHeight: 1449 },
  openframe: { width: 800, height: 480, pixelRatio: 1, colorDepth: 24, deviceWidth: 800, deviceHeight: 480 },
  palma: { width: 824, height: 412, pixelRatio: 2, colorDepth: 4, deviceWidth: 1648, deviceHeight: 824 },
  playdate: { width: 400, height: 240, pixelRatio: 1, colorDepth: 1, deviceWidth: 400, deviceHeight: 240 },
  raspberry_pi_touch_2: { width: 1067, height: 600, pixelRatio: 1.1996, colorDepth: 24, deviceWidth: 1280, deviceHeight: 720 },
  remarkable_paper_2: { width: 780, height: 1040, pixelRatio: 1.8, colorDepth: 4, deviceWidth: 1404, deviceHeight: 1872 },
  seeed_e1003: { width: 1040, height: 780, pixelRatio: 1.8, colorDepth: 4, deviceWidth: 1872, deviceHeight: 1404 },
  seeed_e1004: { width: 1040, height: 780, pixelRatio: 1.5385, colorDepth: 1, deviceWidth: 1600, deviceHeight: 1200 },
  v2: { width: 1040, height: 780, pixelRatio: 1.8, colorDepth: 4, deviceWidth: 1872, deviceHeight: 1404 },
  waveshare_5_8_bw: { width: 800, height: 593, pixelRatio: 0.81, colorDepth: 2, deviceWidth: 648, deviceHeight: 480 },
} as const satisfies Record<string, FrameworkDeviceProfile>;

export type FrameworkDeviceId = keyof typeof FRAMEWORK_DEVICES;

export const FRAMEWORK_DEVICE_IDS = Object.keys(FRAMEWORK_DEVICES) as [
  FrameworkDeviceId,
  ...FrameworkDeviceId[],
];

export function getDeviceProfile(id: FrameworkDeviceId): FrameworkDeviceProfile {
  return FRAMEWORK_DEVICES[id];
}
