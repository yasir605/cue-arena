export const TABLE = {
  length: 3.569,
  width: 1.778,
  cushionHeight: 0.038,
  railWidth: 0.115,
  ballRadius: 0.02625,
  ballMass: 0.142,
  // v4.6.2: slightly more forgiving snooker mouths. The opening is now
  // visibly and physically wider than one 52.5 mm ball while preserving
  // tighter snooker geometry than the pool table.
  cornerPocketOpening: 0.094,
  middlePocketOpening: 0.100,
  // Snooker pockets use more rounded jaws than American pool. These values
  // are intentionally conservative because the snooker table is not governed
  // by the WPA pool-table cut-angle specification.
  cornerPocketCutAngle: 33,
  middlePocketCutAngle: 68,
  cornerPocketShelf: 0.027,
  middlePocketShelf: 0.008,
};

export const POOL_TABLE = Object.freeze({
  length: 2.54,
  width: 1.27,
  cushionHeight: 0.037,
  railWidth: 0.105,
  ballRadius: 0.028575,
  ballMass: 0.17,
  // WPA recommended mouth widths: 4.5 in corner, 5 in side.
  cornerPocketOpening: 0.1143,
  middlePocketOpening: 0.127,
  // WPA horizontal cut angles are 142° corner / 104° side. The collision
  // geometry uses their deflection from a straight cushion (38° / 76°).
  cornerPocketCutAngle: 38,
  middlePocketCutAngle: 76,
  // Shelf is represented in top-down physics as the distance the ball centre
  // must travel beyond the mouth before the drop region is reached.
  cornerPocketShelf: 0.036,
  middlePocketShelf: 0.007,
});

// Physics calibration for the 2D simulator. Values are expressed in SI units
// (metres, seconds, kilograms) and are shared by live play, AI and aim preview.
export const PHYSICS = {
  fixedDt: 1 / 120,
  maxSubsteps: 18,
  gravity: 9.81,

  ballRestitution: 0.94,
  ballFriction: 0.045,

  // v5.8 monotonic cushion response. Low-speed impacts lose proportionally
  // more normal speed, so the rebound opens a few degrees. As speed rises the
  // response approaches a specular reflection instead of crossing friction
  // regimes and wandering back and forth with power.
  cushionRestitution: 0.74,
  cushionRestitutionFast: 0.89,
  cushionFriction: 0.18,
  cushionResponseLowSpeed: 0.35,
  cushionResponseHighSpeed: 7.0,
  cushionLowSpeedAngleRatio: 1.105,
  cushionFastAngleRatio: 1.0,
  cushionSpinTransferSlow: 0.18,
  cushionSpinTransferFast: 0.07,
  cushionSpinDeflectCap: 0.20,

  slideFriction: 0.205,
  rollingResistance: 0.0105,
  lowSpeedResistanceBoost: 0.018,
  lowSpeedResistanceRange: 0.13,
  viscousRollingDrag: 0.012,
  slipToRollSpeed: 0.006,

  spinDecayMoving: 0.52,
  spinDecaySlow: 2.8,

  settleSpeed: 0.0045,
  settleSlipSpeed: 0.0065,
  settleDelay: 0.16,
  hardStopSpeed: 0.0018,

  penetrationSlop: 0.00012,
  positionCorrection: 0.78,

  // Pocket shelf behaviour. These are deliberately weak: jaws and cushion
  // geometry decide whether the ball enters; the shelf only removes the
  // artificial pinball-like bounce once the centre is already through the mouth.
  pocketShelfDamping: 5.2,
  pocketShelfPull: 0.62,
  pocketLateralPull: 0.48,
};

export const CUE_PHYSICS = {
  maxCueSpeed: 7.0,
  // v5.1: preserve touch-shot control while adding 45% more speed at full power.
  fullPowerBoost: 0.45,
  maxTipOffset: 0.72,
  maxSquirtDegrees: 1.8,
  extremeSpinSpeedLoss: 0.10,
};
