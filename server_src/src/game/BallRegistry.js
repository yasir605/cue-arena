export const BALL_VALUES = Object.freeze({
  Cue: 0,
  Red: 1,
  Yellow: 2,
  Green: 3,
  Brown: 4,
  Blue: 5,
  Pink: 6,
  Black: 7,
});

export const COLOUR_ORDER = Object.freeze(['Yellow','Green','Brown','Blue','Pink','Black']);

export function isCue(ball){ return !!ball && ball.kind === 'cue'; }
export function isRed(ball){ return !!ball && ball.kind === 'red'; }
export function isColour(ball){ return !!ball && ball.kind === 'colour'; }
export function valueOf(ball){ return ball?.value ?? 0; }
export function displayBall(ball){
  if(!ball) return 'NONE';
  return ball.kind === 'red' ? 'RED' : String(ball.name || 'BALL').toUpperCase();
}
