export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  clone() { return new Vec2(this.x, this.y); }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  scale(s) { this.x *= s; this.y *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y; }
  lenSq() { return this.x * this.x + this.y * this.y; }
  len() { return Math.hypot(this.x, this.y); }
  normalize() { const l = this.len(); if (l > 1e-12) this.scale(1 / l); return this; }
  perp() { return new Vec2(-this.y, this.x); }
  static sub(a,b) { return new Vec2(a.x-b.x, a.y-b.y); }
  static add(a,b) { return new Vec2(a.x+b.x, a.y+b.y); }
}
