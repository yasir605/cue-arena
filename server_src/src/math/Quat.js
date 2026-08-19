export function integrateQuat(q, w, dt) {
  const [x,y,z,s] = q;
  const [wx,wy,wz] = w;
  const hx = 0.5 * dt;
  const nx = x + hx * ( wx*s + wy*z - wz*y );
  const ny = y + hx * (-wx*z + wy*s + wz*x );
  const nz = z + hx * ( wx*y - wy*x + wz*s );
  const ns = s + hx * (-wx*x - wy*y - wz*z );
  const inv = 1 / Math.hypot(nx,ny,nz,ns);
  q[0]=nx*inv; q[1]=ny*inv; q[2]=nz*inv; q[3]=ns*inv;
}
