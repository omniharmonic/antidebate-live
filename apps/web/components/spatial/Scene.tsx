'use client';

/**
 * WebGL layer of the spatial explorer. Loaded lazily (next/dynamic, ssr:false)
 * so three.js stays out of every other route. All geometry is instanced and
 * rebuilt from refs inside the frame loop; React only re-renders when the
 * arrangement or selection changes.
 *
 * Drawing rules (DIRECTION §5): wireframe strata, uniform node size, participant
 * colour plus a name in the legend, violet only for shared ground and higher-ground
 * candidates, relations only for cross-side attacks, convergence and the selection.
 */
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GEOM, HG_Y, STRATA, planeY, zOf, type Arrangement, type SRel, type SpatialModel } from '@/lib/spatial-model';

export interface LabelSpec {
  key: string;
  anchor: { id: string } | { mid: [string, string] } | { pos: [number, number, number] };
}

export interface SceneApi {
  reset: () => void;
  focus: (id: string) => void;
}

export interface SceneProps {
  model: SpatialModel;
  arrangement: Arrangement;
  range: [number, number];
  selected: string | null;
  hovered: string | null;
  neighborhood: Set<string> | null;
  selectedRels: SRel[];
  labels: LabelSpec[];
  labelEls: React.RefObject<Map<string, HTMLElement>>;
  api: React.RefObject<SceneApi | null>;
  present: boolean;
  reducedMotion: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

const C = {
  bg: new THREE.Color('#090d11'),
  a: new THREE.Color('#8cd5e8'),
  b: new THREE.Color('#a4b8f5'),
  shared: new THREE.Color('#b9a4e3'),
  disputed: new THREE.Color('#e8eef2'),
  both: new THREE.Color('#b0bcc7'),
  rule: new THREE.Color('#1d2630'),
  ruleStrong: new THREE.Color('#3a4654'),
  control: new THREE.Color('#637485'),
  focus: new THREE.Color('#d1e8fa'),
  text2: new THREE.Color('#b0bcc7'),
};

/** Home framing, relative to the focus depth (the middle of the visible span of time). */
const CAMERA_HOME = { pos: new THREE.Vector3(5, 24, 56), target: new THREE.Vector3(-1.6, 4.6, 0) };
const ATTACK = new Set(['rebuts', 'undercuts', 'undermines']);

export default function Scene(props: SceneProps) {
  // current (animated) positions, shared by the graph and the camera focus
  const positions = useRef(new Map<string, THREE.Vector3>());
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 34, near: 0.5, far: 400, position: CAMERA_HOME.pos.toArray() }}
      onPointerMissed={() => props.onHover(null)}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden
    >
      <color attach="background" args={['#090d11']} />
      <Controls api={props.api} present={props.present} reducedMotion={props.reducedMotion} positions={positions} focusZ={(props.arrangement.zFrom + props.arrangement.zTo) / 2} />
      <Planes model={props.model} range={props.range} arrangement={props.arrangement} />
      <Graph {...props} positions={positions} />
    </Canvas>
  );
}

/* ---------- camera ---------- */

function Controls({
  api,
  present,
  reducedMotion,
  positions,
  focusZ,
}: {
  api: SceneProps['api'];
  present: boolean;
  reducedMotion: boolean;
  positions: React.RefObject<Map<string, THREE.Vector3>>;
  /** The camera follows this depth as the playhead moves, keeping the user's angle and zoom. */
  focusZ: number;
}) {
  const { camera, gl } = useThree();
  const ctl = useRef<OrbitControls | null>(null);
  const focusTo = useRef<THREE.Vector3 | null>(null);
  const followed = useRef<number | null>(null);
  const wantZ = useRef(focusZ);
  useEffect(() => {
    wantZ.current = focusZ;
  }, [focusZ]);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    const z = wantZ.current;
    followed.current = z;
    camera.position.copy(CAMERA_HOME.pos).add(new THREE.Vector3(0, 0, z));
    c.target.copy(CAMERA_HOME.target).add(new THREE.Vector3(0, 0, z));
    c.enableDamping = !reducedMotion;
    c.dampingFactor = 0.09;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.minDistance = 6;
    c.maxDistance = 140;
    c.maxPolarAngle = Math.PI * 0.49;
    c.screenSpacePanning = true;
    c.update();
    ctl.current = c;
    return () => c.dispose();
  }, [camera, gl, reducedMotion]);

  useImperativeHandle(
    api,
    () => ({
      reset: () => {
        const c = ctl.current;
        if (!c) return;
        focusTo.current = null;
        const z = wantZ.current;
        followed.current = z;
        camera.position.copy(CAMERA_HOME.pos).add(new THREE.Vector3(0, 0, z));
        c.target.copy(CAMERA_HOME.target).add(new THREE.Vector3(0, 0, z));
        c.update();
      },
      focus: (id: string) => {
        const p = positions.current?.get(id);
        if (!p || !ctl.current) return;
        if (reducedMotion) {
          const d = p.clone().sub(ctl.current.target);
          ctl.current.target.add(d);
          camera.position.add(d);
          ctl.current.update();
        } else focusTo.current = p.clone();
      },
    }),
    [camera, reducedMotion, positions],
  );

  useFrame((state, dt) => {
    const c = ctl.current;
    if (!c) return;
    c.autoRotate = present && !reducedMotion;
    c.autoRotateSpeed = 0.35;
    if (followed.current !== null && followed.current !== wantZ.current) {
      const next = reducedMotion ? wantZ.current : followed.current + (wantZ.current - followed.current) * Math.min(1, dt * 4);
      const d = Math.abs(next - wantZ.current) < 0.001 ? wantZ.current - followed.current : next - followed.current;
      followed.current += d;
      c.target.z += d;
      state.camera.position.z += d;
    }
    if (focusTo.current) {
      const k = Math.min(1, dt * 5);
      const d = focusTo.current.clone().sub(c.target).multiplyScalar(k);
      c.target.add(d);
      state.camera.position.add(d);
      if (focusTo.current.distanceTo(c.target) < 0.02) focusTo.current = null;
    }
    c.update();
  });
  return null;
}

/* ---------- strata planes, phase boundaries, playhead slice ---------- */

function pushSeg(arr: number[], cols: number[], a: [number, number, number], b: [number, number, number], c: THREE.Color) {
  arr.push(...a, ...b);
  cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
}

function Planes({ model, range, arrangement }: { model: SpatialModel; range: [number, number]; arrangement: Arrangement }) {
  const W = GEOM.halfWidth + 0.8;
  const z0 = -GEOM.depth / 2 - 0.6;
  // planes end at the playhead: the map shows the conversation so far
  const z1 = Math.min(arrangement.zTo, GEOM.depth / 2) + 0.6;

  const statics = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    for (const st of STRATA) {
      const y = planeY(st);
      pushSeg(pos, col, [-W, y, z0], [W, y, z0], C.ruleStrong);
      pushSeg(pos, col, [-W, y, z1], [W, y, z1], C.ruleStrong);
      pushSeg(pos, col, [-W, y, z0], [-W, y, z1], C.ruleStrong);
      pushSeg(pos, col, [W, y, z0], [W, y, z1], C.ruleStrong);
      // median (dashed)
      for (let z = z0; z < z1; z += 1.2) pushSeg(pos, col, [0, y, z], [0, y, Math.min(z + 0.5, z1)], C.rule);
      // band edges between sides and the centre
      for (const x of [-GEOM.inner[0] + 0.5, GEOM.inner[0] - 0.5]) for (let z = z0; z < z1; z += 2.4) pushSeg(pos, col, [x, y, z], [x, y, Math.min(z + 0.25, z1)], C.rule);
    }
    // round boundaries on the base plane, phase boundaries across every plane
    const yBase = planeY('ontology');
    for (const r of model.rounds) {
      if (r.startMs < range[0] || r.startMs > range[1]) continue;
      const z = zOf(r.startMs, range);
      if (z > z1) continue;
      pushSeg(pos, col, [-W, yBase, z], [W, yBase, z], C.rule);
    }
    let lastPhase: string | null = null;
    for (const b of model.bands) {
      if (b.phase === 'none' || b.phase === lastPhase) continue;
      lastPhase = b.phase;
      if (b.startMs <= range[0] || b.startMs > range[1]) continue;
      const z = zOf(b.startMs, range);
      if (z > z1) continue;
      for (const st of STRATA) pushSeg(pos, col, [-W, planeY(st), z], [W, planeY(st), z], C.ruleStrong);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [model, range, W, z0, z1]);

  useEffect(() => () => statics.dispose(), [statics]);

  // the playhead slice: a section through every stratum at the playhead's depth
  const slice = useMemo(() => {
    const z = Math.min(arrangement.zTo, GEOM.depth / 2);
    const top = planeY('praxis') + 0.8;
    const bottom = -0.8;
    const pos: number[] = [];
    const col: number[] = [];
    pushSeg(pos, col, [-W, bottom, z], [W, bottom, z], C.control);
    pushSeg(pos, col, [-W, top, z], [W, top, z], C.control);
    pushSeg(pos, col, [-W, bottom, z], [-W, top, z], C.control);
    pushSeg(pos, col, [W, bottom, z], [W, top, z], C.control);
    for (const st of STRATA) pushSeg(pos, col, [-W, planeY(st), z], [W, planeY(st), z], C.control);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [arrangement.zTo, W]);
  useEffect(() => () => slice.dispose(), [slice]);

  const mat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }), []);
  const sliceMat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.85 }), []);
  return (
    <>
      <lineSegments geometry={statics} material={mat} />
      <lineSegments geometry={slice} material={sliceMat} />
    </>
  );
}

/* ---------- propositions, candidates, relations, annotations ---------- */

interface Item {
  id: string;
  target: THREE.Vector3;
  color: THREE.Color;
  ring: boolean;
  scale: number;
  stubs: boolean;
  dim: boolean;
  kind: 'node' | 'hg';
}

const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();

function Graph({ model, arrangement, selected, hovered, neighborhood, selectedRels, labels, labelEls, reducedMotion, onHover, onSelect, positions }: SceneProps & { positions: React.RefObject<Map<string, THREE.Vector3>> }) {
  const { camera, size } = useThree();
  const cap = model.nodes.length + model.hgs.length + 4;

  const geo = useMemo(
    () => ({
      disc: new THREE.CircleGeometry(0.17, 24),
      ring: new THREE.RingGeometry(0.115, 0.19, 28),
      hg: new THREE.RingGeometry(0.2, 0.28, 32),
      hit: new THREE.SphereGeometry(0.42, 8, 6),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      solid: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }),
      hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
      line: new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }),
      bracket: new THREE.LineBasicMaterial({ color: C.focus, toneMapped: false }),
      frame: new THREE.LineBasicMaterial({ color: C.disputed, toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats],
  );

  const solid = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const hgMesh = useRef<THREE.InstancedMesh>(null);
  const hit = useRef<THREE.InstancedMesh>(null);
  const hitIds = useRef<string[]>([]);

  const pos = positions;
  const appear = useRef(new Map<string, number>());

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const active = neighborhood !== null;
    for (const p of arrangement.placed) {
      const id = p.node.pid;
      const base = p.tone === 'a' ? C.a : p.tone === 'b' ? C.b : p.tone === 'shared' ? C.shared : p.tone === 'disputed' ? C.disputed : C.both;
      const inN = !active || neighborhood!.has(id) || id === hovered;
      const color = base.clone();
      if (!inN) color.lerp(C.bg, 0.8);
      const isCrux = arrangement.crux?.pid === id;
      const scale = id === selected ? 1.6 : id === hovered ? 1.45 : isCrux ? 1.35 : 1;
      out.push({ id, target: new THREE.Vector3(p.x, p.y, p.z), color, ring: p.ring, scale, stubs: p.column === 'both', dim: !inN, kind: 'node' });
    }
    for (const h of arrangement.hgs) {
      const id = `hg:${h.id}`;
      const inN = !active || neighborhood!.has(id) || id === hovered;
      const current = arrangement.hg?.id === h.id;
      const color = C.shared.clone();
      if (!inN) color.lerp(C.bg, 0.8);
      else if (!current && id !== selected && id !== hovered) color.lerp(C.bg, 0.45);
      const scale = id === selected ? 1.5 : id === hovered ? 1.35 : current ? 1.2 : 0.85;
      out.push({ id, target: new THREE.Vector3(h.x, HG_Y, h.z), color, ring: true, scale, stubs: false, dim: !inN, kind: 'hg' });
    }
    return out;
  }, [arrangement, neighborhood, selected, hovered]);


  // lines: rebuilt every frame from animated positions
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = (model.nodes.length * 2 + model.relations.length + model.hgs.length * 8 + 64) * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    return g;
  }, [model]);
  useEffect(() => () => lineGeo.dispose(), [lineGeo]);

  // bracket (selection) and frame (crux) outlines in a camera-facing local plane
  const bracketGeo = useMemo(() => {
    const r = 0.46;
    const l = 0.16;
    const pts: number[] = [];
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      pts.push(sx * r, sy * r, 0, sx * r, sy * r - sy * l, 0);
      pts.push(sx * r, sy * r, 0, sx * r - sx * l, sy * r, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const frameGeo = useMemo(() => {
    const r = 0.62;
    const pts = [-r, -r, 0, r, -r, 0, r, -r, 0, r, r, 0, r, r, 0, -r, r, 0, -r, r, 0, -r, -r, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const bracket = useRef<THREE.LineSegments>(null);
  const frame = useRef<THREE.LineSegments>(null);

  const latest = useRef({ items, arrangement, selected, neighborhood, selectedRels, labels });
  useEffect(() => {
    latest.current = { items, arrangement, selected, neighborhood, selectedRels, labels };
  }, [items, arrangement, selected, neighborhood, selectedRels, labels]);

  useFrame((_, dt) => {
    const L = latest.current;
    const P = pos.current;
    const A = appear.current;
    const k = reducedMotion ? 1 : Math.min(1, dt * 7);
    const live = new Set<string>();
    let ns = 0;
    let nr = 0;
    let nh = 0;
    const ids: string[] = [];
    // a bulk arrival (first load, a seek) appears at once; only a trickle animates in
    let fresh = 0;
    for (const it of L.items) if (!P.has(it.id)) fresh++;
    const instant = reducedMotion || fresh > 24;
    for (const it of L.items) {
      live.add(it.id);
      let p = P.get(it.id);
      if (!p) {
        p = it.target.clone();
        P.set(it.id, p);
        A.set(it.id, instant ? 1 : 0);
      } else p.lerp(it.target, k);
      const a = Math.min(1, (A.get(it.id) ?? 1) + (reducedMotion ? 1 : dt / 0.55));
      A.set(it.id, a);
      const s = it.scale * (0.35 + 0.65 * a);
      tmpS.set(s, s, s);
      tmpM.compose(p, camera.quaternion, tmpS);
      tmpC.copy(it.color).lerp(C.bg, 1 - a);
      if (it.kind === 'hg') {
        hgMesh.current?.setMatrixAt(nh, tmpM);
        hgMesh.current?.setColorAt(nh, tmpC);
        nh++;
      } else if (it.ring) {
        rings.current?.setMatrixAt(nr, tmpM);
        rings.current?.setColorAt(nr, tmpC);
        nr++;
      } else {
        solid.current?.setMatrixAt(ns, tmpM);
        solid.current?.setColorAt(ns, tmpC);
        ns++;
      }
      if (!it.dim) {
        tmpM.compose(p, camera.quaternion, tmpS.set(1, 1, 1));
        hit.current?.setMatrixAt(ids.length, tmpM);
        ids.push(it.id);
      }
    }
    for (const id of [...P.keys()]) {
      if (live.has(id)) continue;
      P.delete(id);
      A.delete(id);
    }
    for (const [m, n] of [
      [solid.current, ns],
      [rings.current, nr],
      [hgMesh.current, nh],
    ] as const) {
      if (!m) continue;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (hit.current) {
      hit.current.count = ids.length;
      hit.current.instanceMatrix.needsUpdate = true;
      hit.current.computeBoundingSphere();
      hitIds.current = ids;
    }

    // lines
    const posA = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const colA = lineGeo.getAttribute('color') as THREE.BufferAttribute;
    const pa = posA.array as Float32Array;
    const ca = colA.array as Float32Array;
    const maxV = pa.length / 3;
    let v = 0;
    const seg = (x1: THREE.Vector3, x2: THREE.Vector3, c: THREE.Color) => {
      if (v + 2 > maxV) return;
      pa.set([x1.x, x1.y, x1.z, x2.x, x2.y, x2.z], v * 3);
      ca.set([c.r, c.g, c.b, c.r, c.g, c.b], v * 3);
      v += 2;
    };
    const active = L.neighborhood !== null;
    const inN = (id: string) => !active || L.neighborhood!.has(id);
    const cl = new THREE.Color();
    // stance attachments on propositions both sides hold
    for (const it of L.items) {
      if (!it.stubs) continue;
      const p = P.get(it.id);
      if (!p) continue;
      const pl = L.arrangement.byId.get(it.id);
      const dim = !inN(it.id);
      const s = it.scale;
      tmpV.copy(p).add(new THREE.Vector3(-0.62 * s, 0, 0));
      seg(new THREE.Vector3(p.x - 0.22 * s, p.y, p.z), tmpV, cl.copy(C.a).lerp(C.bg, dim ? 0.8 : pl?.latest.a?.attitude === 'rejects' ? 0.35 : 0));
      tmpV.copy(p).add(new THREE.Vector3(0.62 * s, 0, 0));
      seg(new THREE.Vector3(p.x + 0.22 * s, p.y, p.z), tmpV, cl.copy(C.b).lerp(C.bg, dim ? 0.8 : pl?.latest.b?.attitude === 'rejects' ? 0.35 : 0));
    }
    const drawn = new Set<string>();
    const selSet = new Set(L.selectedRels.map((r) => r.id));
    for (const r of L.selectedRels) {
      const p1 = P.get(r.from);
      const p2 = P.get(r.to);
      if (!p1 || !p2) continue;
      drawn.add(r.id);
      seg(p1, p2, ATTACK.has(r.type) ? C.focus : cl.copy(C.text2).lerp(C.bg, r.inferred ? 0.35 : 0));
    }
    for (const r of L.arrangement.clashes) {
      if (drawn.has(r.id)) continue;
      const p1 = P.get(r.from);
      const p2 = P.get(r.to);
      if (!p1 || !p2) continue;
      const dim = active && !selSet.has(r.id) && !(inN(r.from) && inN(r.to));
      seg(p1, p2, cl.copy(C.control).lerp(C.bg, dim ? 0.8 : 0.15));
    }
    for (const c of L.arrangement.converging) {
      const p1 = P.get(c.ids[0]);
      const p2 = P.get(c.ids[1]);
      if (!p1 || !p2) continue;
      const dim = active && !(inN(c.ids[0]) || inN(c.ids[1]));
      seg(p1, p2, cl.copy(C.shared).lerp(C.bg, dim ? 0.85 : 0.35));
    }
    // higher-ground filaments: the selected candidate, else the current one
    const hgSel = L.selected?.startsWith('hg:') ? L.selected.slice(3) : null;
    const hgShow = L.arrangement.hgs.find((h) => h.id === hgSel) ?? (active ? null : L.arrangement.hg);
    if (hgShow) {
      const ph = P.get(`hg:${hgShow.id}`);
      if (ph)
        for (const ids of Object.values(hgShow.body.derivation))
          for (const id of ids) {
            const pn = P.get(id);
            if (pn) seg(ph, pn, cl.copy(C.shared).lerp(C.bg, hgSel ? 0.1 : 0.72));
          }
    }
    posA.needsUpdate = true;
    colA.needsUpdate = true;
    lineGeo.setDrawRange(0, v);

    // selection brackets and the crux frame face the camera
    const sp = L.selected ? P.get(L.selected) : undefined;
    if (bracket.current) {
      bracket.current.visible = Boolean(sp);
      if (sp) {
        bracket.current.position.copy(sp);
        bracket.current.quaternion.copy(camera.quaternion);
        const s = L.selected!.startsWith('hg:') ? 1.3 : 1;
        bracket.current.scale.set(s, s, s);
      }
    }
    const cp = L.arrangement.crux ? P.get(L.arrangement.crux.pid) : undefined;
    if (frame.current) {
      frame.current.visible = Boolean(cp);
      if (cp) {
        frame.current.position.copy(cp);
        frame.current.quaternion.copy(camera.quaternion);
      }
    }

    // DOM labels follow their anchors
    const els = labelEls.current;
    if (els) {
      for (const l of L.labels) {
        const el = els.get(l.key);
        if (!el) continue;
        let w: THREE.Vector3 | undefined;
        if ('id' in l.anchor) w = P.get(l.anchor.id);
        else if ('mid' in l.anchor) {
          const p1 = P.get(l.anchor.mid[0]);
          const p2 = P.get(l.anchor.mid[1]);
          if (p1 && p2) w = tmpV.copy(p1).add(p2).multiplyScalar(0.5);
        } else w = tmpV.set(...l.anchor.pos);
        if (!w) {
          el.style.visibility = 'hidden';
          continue;
        }
        const pr = tmpV.copy(w).project(camera);
        if (pr.z > 1 || pr.z < -1) {
          el.style.visibility = 'hidden';
          continue;
        }
        const x = ((pr.x + 1) / 2) * size.width;
        const y = ((1 - pr.y) / 2) * size.height;
        el.style.visibility = 'visible';
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  });

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? hitIds.current[e.instanceId] ?? null : null);

  return (
    <>
      <instancedMesh ref={solid} args={[geo.disc, mats.solid, cap]} frustumCulled={false} />
      <instancedMesh ref={rings} args={[geo.ring, mats.solid, cap]} frustumCulled={false} />
      <instancedMesh ref={hgMesh} args={[geo.hg, mats.solid, Math.max(1, model.hgs.length + 1)]} frustumCulled={false} />
      <lineSegments geometry={lineGeo} material={mats.line} frustumCulled={false} />
      <lineSegments ref={bracket} geometry={bracketGeo} material={mats.bracket} visible={false} />
      <lineSegments ref={frame} geometry={frameGeo} material={mats.frame} visible={false} />
      <instancedMesh
        ref={hit}
        args={[geo.hit, mats.hit, cap]}
        onPointerMove={(e) => {
          e.stopPropagation();
          onHover(idAt(e));
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta > 4) return;
          const id = idAt(e);
          if (id) onSelect(id);
        }}
      />
    </>
  );
}
