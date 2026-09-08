export const CFG = {
  laps: 3,
  racers: 4,
  accel: 36, dragK: 0.0078, rollRes: 2.2,      // → top speed ≈ 65
  topSpeed: 65,
  // Drift yaw = (steer*0.75 + driftDir*0.35) * steerRate * authority * mul.
  // At full lock that is ~2.6 rad/s, i.e. a 25-unit minimum radius against 38
  // when gripping — the whole point of the hairpins. The old formula carried a
  // 0.85 fixed bias that forced a 17-unit radius, so holding drift through an
  // ordinary corner speared the kart into the inside barrier.
  steerRate: 2.35, driftSteerMul: 1.35, driftSteerIn: .75, driftSteerBias: .35,
  driftScrub: 3.0,
  driftChargeRate: 1.15, driftTiers: [0.6, 1.4, 2.3],
  // Absolute per-tier ceilings rather than a multiplier on a shared cap: the
  // old form multiplied 94 by up to 1.55 and let a tier-3 turbo reach 145.
  boostDur: [0.7, 1.15, 1.7], boostTop: [73, 81, 89], boostAcc: [70, 82, 94],
  kartRadius: 2.1, wallBounce: 0.42,
  hitSpinTime: 0.95, hitSpeedMul: 0.32,
  rouletteTime: 0.72,
};
export const ORD = ['ST','ND','RD','TH'];
