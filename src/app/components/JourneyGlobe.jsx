'use client';

/**
 * Decorative 3D globe behind the journey panel of the application (three.js, loaded after the form with next/dynamic).
 * A sphere of glowing points in the brand blues and golds, wrapped by one orbit ring per step: a ring turns gold when
 * that step is done, the current one pulses, and a small light travels along each finished ring. The globe leans
 * gently toward the pointer.
 * Pauses when the tab is hidden or the panel is off screen; draws a single still frame when the visitor asks for
 * reduced motion. Purely visual (aria-hidden); the panel stays readable and works without it (WebGL missing → nothing).
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const BLUE = new THREE.Color('#7d8ff0');
const DEEP = new THREE.Color('#3a4fb8');
const GOLD = new THREE.Color('#e3c398');
const FAINT = new THREE.Color('#ffffff');

/** Round soft dot used for every point (drawn once on a small canvas). */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Evenly spread points on a sphere (Fibonacci lattice), coloured blue → gold with a little variation. */
function spherePoints(count, radius) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    pos.set([Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius], i * 3);
    const mix = (Math.sin(a * 0.7) + Math.cos(y * 6)) * 0.25 + 0.5;
    c.copy(DEEP).lerp(BLUE, mix);
    if (Math.sin(i * 12.9898) > 0.82) c.copy(GOLD); // scattered gold "cities"
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function ringLine(radius) {
  const pts = [];
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

export default function JourneyGlobe({ done = 0, total = 5, finished = false }) {
  const hostRef = useRef(null);
  const stateRef = useRef({ done, total, finished });
  stateRef.current = { done, total, finished };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return; // no WebGL: the panel simply shows its gradient
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 9);

    const world = new THREE.Group(); // placed per layout in resize()
    const globe = new THREE.Group();
    world.add(globe);
    scene.add(world);

    const sprite = dotTexture();
    const RADIUS = 2.2;
    const points = new THREE.Points(
      spherePoints(1600, RADIUS),
      new THREE.PointsMaterial({ size: 0.075, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 })
    );
    globe.add(points);

    // faint halo around the sphere
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.02, 48, 48),
      new THREE.MeshBasicMaterial({ color: DEEP, transparent: true, opacity: 0.08, side: THREE.BackSide })
    );
    globe.add(halo);

    // drifting dust around the globe
    const dustGeo = new THREE.BufferGeometry();
    const dust = new Float32Array(260 * 3);
    for (let i = 0; i < 260; i++) {
      const r = RADIUS * (1.5 + Math.random() * 1.6);
      const a = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 5;
      dust.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.05, map: sprite, color: GOLD, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    world.add(dustPts);

    // one orbit ring per step, each with a travelling light
    const rings = [];
    const ringRoot = new THREE.Group();
    world.add(ringRoot);
    const buildRings = (n) => {
      rings.splice(0).forEach((r) => ringRoot.remove(r.group));
      for (let i = 0; i < n; i++) {
        const group = new THREE.Group();
        group.rotation.set(0.35 + i * 0.42, i * 0.9, 0.18 * i);
        const mat = new THREE.LineBasicMaterial({ color: FAINT, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
        const line = new THREE.LineLoop(ringLine(RADIUS * (1.22 + i * 0.13)), mat);
        const bead = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: GOLD, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        bead.scale.setScalar(0.32);
        group.add(line, bead);
        ringRoot.add(group);
        rings.push({ group, mat, bead, radius: RADIUS * (1.22 + i * 0.13), speed: 0.25 + i * 0.07, phase: i * 1.7 });
      }
    };
    buildRings(stateRef.current.total);

    // layout: the globe sits low and to the right of the panel; on the short phone header it sits to the right
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const wide = w / h > 1; // phone header (wider than tall) vs the tall desktop panel
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const halfW = halfH * camera.aspect;
      // the sphere (with its rings, about 1.7× its radius) fills most of the panel's width, low down
      const fit = wide ? (halfH * 0.62) / RADIUS : (halfW * 0.8) / RADIUS;
      world.scale.setScalar(fit);
      world.position.set(wide ? halfW * 0.62 : halfW * 0.62, wide ? 0 : -halfH * 0.74, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // gentle lean toward the pointer
    const target = { x: 0, y: 0 };
    const onMove = (e) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 0.5;
      target.y = (e.clientY / window.innerHeight - 0.5) * 0.35;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0;
    let visible = true;
    let last = performance.now();
    let t = 0;
    let burst = 0;
    let wasFinished = stateRef.current.finished;
    const gold = new THREE.Color();

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const { done: d, total: n, finished: f } = stateRef.current;
      if (rings.length !== n) buildRings(n);
      if (f && !wasFinished) burst = 1;
      wasFinished = f;
      burst = Math.max(0, burst - dt * 0.6);

      globe.rotation.y += dt * (0.08 + burst * 0.8);
      dustPts.rotation.y -= dt * 0.02;
      world.rotation.x += (target.y - world.rotation.x) * 0.04;
      world.rotation.z += (-target.x * 0.3 - world.rotation.z) * 0.04;
      ringRoot.rotation.y = target.x * 0.6 + t * 0.03;
      points.material.size = 0.075 * (1 + burst * 0.6);

      const k = reduce ? 1 : 0.08; // reduced motion: one still frame, so jump straight to the end state
      rings.forEach((r, i) => {
        const isDone = f || i < d;
        const isNow = !f && i === d;
        const pulse = isNow ? 0.35 + Math.sin(t * 3) * 0.15 : 0;
        const want = isDone ? 0.55 : isNow ? pulse : 0.1;
        r.mat.opacity += (want - r.mat.opacity) * k;
        gold.copy(isDone || isNow ? GOLD : FAINT);
        r.mat.color.lerp(gold, k);
        const a = t * r.speed + r.phase;
        r.bead.position.set(Math.cos(a) * r.radius, 0, Math.sin(a) * r.radius);
        r.bead.material.opacity += ((isDone ? 0.95 : 0) - r.bead.material.opacity) * k;
      });

      renderer.render(scene, camera);
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    start();

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && !document.hidden;
      if (visible && !reduce) start();
    });
    io.observe(host);
    const onVis = () => {
      visible = !document.hidden;
      if (visible && !reduce) start();
    };
    document.addEventListener('visibilitychange', onVis);
    const redraw = () => requestAnimationFrame(frame);
    host.addEventListener('globe-redraw', redraw);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      host.removeEventListener('globe-redraw', redraw);
      window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      sprite.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // reduced motion draws one frame at mount; redraw it when the progress changes
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) hostRef.current?.dispatchEvent(new Event('globe-redraw'));
  }, [done, total, finished]);

  return <div ref={hostRef} className="ap-globe" aria-hidden="true" />;
}
