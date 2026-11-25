import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  alturaMaxima, codProf, codRack, colorCliente, distribucion, esRackPeligrosos, generarCatalogo,
  columnasDeRack, filaDe, infoProfundidad, inicioColumna, leerRack, listaRacks, pasilloAntesDe, rangoProfundidades, zonaDe,
} from './almacenModelo';

// Vista 3D del almacén (three.js).
// - Una sola InstancedMesh para todas las cargas (miles de posiciones en una llamada de dibujo).
// - Posición vacía = escala 0 (no se borra), así cambiar ocupación es solo reescribir matrices.
// - Caja invisible por ubicación para el clic (funciona también en vacías).
// - Dos modos de cámara: vista aérea (OrbitControls) y caminar (primera persona).
// Ejes: X = racks uno al lado del otro, Z = profundidad (001 al frente, stage en Z negativo), Y = altura.

const COLOR_CARTON = new THREE.Color('#c8a165');
const COLOR_CARTON_PEL = new THREE.Color('#e7b04a');
const COLOR_VACIA = new THREE.Color('#e2e8f0');
const COLOR_ESTRUCTURA = '#1d4ed8';
const COLOR_VIGA = '#f97316';
const ALTURA_OJOS = 1.65;

// Teclas del recorrido a pie
const TECLAS = {
  ArrowUp: 'adelante', KeyW: 'adelante',
  ArrowDown: 'atras', KeyS: 'atras',
  ArrowLeft: 'izq', KeyA: 'izq',
  ArrowRight: 'der', KeyD: 'der',
  KeyE: 'subir', KeyQ: 'bajar',
};

const etiqueta = (texto, { escala = 1, fondo = 'rgba(15,23,42,0.85)' } = {}) => {
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  g0.font = 'bold 34px Segoe UI, Arial';
  const w = Math.max(128, Math.ceil(g0.measureText(texto).width) + 40);
  c.width = w;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = fondo;
  g.beginPath();
  g.roundRect(4, 4, w - 8, 56, 12);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 34px Segoe UI, Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texto, w / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(0.8 * escala * (w / 64), 0.8 * escala, 1);
  s.renderOrder = 10;
  return s;
};

// ¿De qué lado del rack está su pasillo? -1 = hacia X menor, +1 = hacia X mayor
const ladoDe = (cfg, dist, r) => {
  if (!esRackPeligrosos(r)) return pasilloAntesDe(cfg, r) ? -1 : 1;
  if (zonaDe(cfg, r) === 'medicos') {
    // médicos crece hacia X mayor: con pasillo antes mira hacia X menor; si no, hacia X mayor
    let d = cfg.medicos.racks.find((x) => x.codigo === r);
    if (d?.mismaXQue) d = cfg.medicos.racks.find((x) => x.codigo === d.mismaXQue) || d;
    const enLinea = cfg.medicos.racks.filter((x) => !x.mismaXQue);
    return enLinea.indexOf(d) > 0 && d.pasilloAntes ? -1 : 1;
  }
  // peligrosos crece desde la pared hacia afuera (s): el pasillo queda hacia la pared,
  // salvo los que van espalda con espalda con el anterior (P3, P5), que miran hacia afuera
  const i = cfg.peligrosos.racks.findIndex((x) => x.codigo === r);
  const s = dist.peligrosos?.s ?? 1;
  const haciaPared = i <= 0 || cfg.peligrosos.racks[i].pasilloAntes;
  return haciaPared ? -s : s;
};

// Rótulo de rack como en la foto: cartel blanco, número negro y flecha roja hacia el pasillo.
const texturaRotulo = (texto, flechaDerecha) => {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 320, 200);
  g.strokeStyle = '#cbd5e1';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 314, 194);
  // flecha (chevron) roja
  const xf = flechaDerecha ? 262 : 58;
  const d = flechaDerecha ? 1 : -1;
  g.strokeStyle = '#dc2626';
  g.lineWidth = 22;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(xf - d * 22, 58);
  g.lineTo(xf + d * 18, 100);
  g.lineTo(xf - d * 22, 142);
  g.stroke();
  g.fillStyle = '#0f172a';
  g.font = `bold ${texto.length > 2 ? 92 : 116}px Segoe UI, Arial`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texto, flechaDerecha ? 135 : 185, 106);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
};

// Apilador (montacargas retráctil) como el de la foto: cuerpo amarillo, techo protector,
// mástil alto, brazos tijera y uñas. Mira hacia +Z.
const crearApilador = () => {
  const g = new THREE.Group();
  const amarillo = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.5 });
  const negro = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.6, metalness: 0.3 });
  const pieza = (sx, sy, sz, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  pieza(1.05, 0.25, 1.3, negro, 0, 0.13, -0.55); // base
  pieza(1.0, 1.05, 1.0, amarillo, 0, 0.75, -0.6); // cuerpo (batería)
  pieza(0.5, 0.35, 0.4, negro, 0, 1.45, -0.55); // asiento
  [[-0.45, -0.15], [0.45, -0.15], [-0.45, -1.05], [0.45, -1.05]].forEach(([x, z]) => pieza(0.05, 1.1, 0.05, negro, x, 1.85, z)); // postes del techo
  pieza(1.0, 0.06, 1.0, negro, 0, 2.42, -0.6); // techo protector
  pieza(0.12, 0.1, 0.12, new THREE.MeshBasicMaterial({ color: '#fbbf24' }), 0.35, 2.5, -0.95); // baliza
  [-0.45, 0.45].forEach((x) => pieza(0.14, 0.14, 1.5, negro, x, 0.07, 0.75)); // patas delanteras
  [-0.32, 0.32].forEach((x) => pieza(0.12, 3.4, 0.12, negro, x, 1.75, 0.05)); // mástil
  pieza(0.76, 0.1, 0.12, negro, 0, 3.4, 0.05);
  pieza(0.76, 0.1, 0.12, negro, 0, 2.2, 0.05);
  // brazos tijera
  [-1, 1].forEach((s) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.75), negro);
    b.position.set(0, 0.85, 0.45);
    b.rotation.x = s * 0.5;
    g.add(b);
  });
  pieza(0.9, 0.7, 0.08, negro, 0, 0.7, 0.85); // placa porta uñas
  [-0.25, 0.25].forEach((x) => pieza(0.12, 0.05, 1.1, negro, x, 0.38, 1.42)); // uñas
  return g;
};

const liberar = (obj) => {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => {
      m.map?.dispose?.();
      m.dispose?.();
    });
  });
};

const plano = (w, l, color, x, z, y = 0.005, opciones = {}) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshStandardMaterial({ color, roughness: 1, ...opciones }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};

const caja = (sx, sy, sz, color, x, y, z, opciones = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opciones }));
  m.position.set(x, y, z);
  return m;
};

export default function Vista3D({ cfg, ocupacion, clientes, modoColor, seleccion, onSeleccionar, onHover }) {
  const contRef = useRef(null);
  const motor = useRef(null);
  const [caminando, setCaminando] = useState(false);

  // ---- Crear el motor una sola vez ----
  useEffect(() => {
    const cont = contRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(cont.clientWidth, cont.clientHeight);
    cont.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef2f7');
    scene.add(new THREE.HemisphereLight('#ffffff', '#94a3b8', 1.6));
    const sol = new THREE.DirectionalLight('#ffffff', 1.4);
    sol.position.set(30, 60, 20);
    scene.add(sol);
    const contra = new THREE.DirectionalLight('#ffffff', 0.5);
    contra.position.set(-30, 30, -40);
    scene.add(contra);

    const camera = new THREE.PerspectiveCamera(55, cont.clientWidth / cont.clientHeight, 0.05, 3000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const marca = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ec4899', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    marca.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)), new THREE.LineBasicMaterial({ color: '#be185d' })));
    marca.visible = false;
    scene.add(marca);

    const m = {
      renderer, scene, camera, controls, grupo: null, codigos: [], clic: null, marca, centro: new THREE.Vector3(),
      // estado del recorrido a pie
      walk: { activo: false, yaw: 0, pitch: 0, teclas: new Set(), tiempo: 0, limites: null },
    };
    motor.current = m;

    const reloj = new THREE.Timer();
    const dir = new THREE.Vector3();
    let raf;
    const loop = () => {
      reloj.update();
      const dt = Math.min(reloj.getDelta(), 0.05);
      const w = m.walk;
      if (w.activo) {
        const t = w.teclas;
        if (t.has('izq')) w.yaw += 1.7 * dt;
        if (t.has('der')) w.yaw -= 1.7 * dt;
        const avanza = (t.has('adelante') ? 1 : 0) - (t.has('atras') ? 1 : 0);
        if (avanza) {
          w.tiempo += dt;
          const vel = Math.min(1.4 + w.tiempo * 1.8, 5); // acelera al mantener
          camera.position.x += Math.sin(w.yaw) * vel * dt * avanza;
          camera.position.z += Math.cos(w.yaw) * vel * dt * avanza;
        } else w.tiempo = 0;
        if (t.has('subir')) camera.position.y += 2 * dt;
        if (t.has('bajar')) camera.position.y -= 2 * dt;
        const L = w.limites;
        if (L) {
          camera.position.x = THREE.MathUtils.clamp(camera.position.x, L.x0, L.x1);
          camera.position.z = THREE.MathUtils.clamp(camera.position.z, L.z0, L.z1);
        }
        camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.4, 40);
        dir.set(Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch));
        camera.lookAt(camera.position.clone().add(dir));
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = cont.clientWidth;
      const h = cont.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(cont);

    // Raycast: clic = apretar y soltar sin arrastrar
    const ray = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    const acertar = (ev) => {
      if (!m.clic) return null;
      const r = renderer.domElement.getBoundingClientRect();
      puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(puntero, camera);
      const hit = ray.intersectObject(m.clic, false)[0];
      return hit ? m.codigos[hit.instanceId] : null;
    };
    let abajo = null;
    let ultimo = null;
    const onDown = (e) => {
      abajo = { x: e.clientX, y: e.clientY, t: Date.now() };
      ultimo = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (!abajo) return;
      const mov = Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y);
      if (mov < 6 && Date.now() - abajo.t < 600) {
        const c = acertar(e);
        if (c) m.onSeleccionar?.(c);
      }
      abajo = null;
    };
    let pendiente = false;
    const onMove = (e) => {
      // Caminando: arrastrar = mirar (la imagen sigue al dedo / mouse)
      if (m.walk.activo && abajo && ultimo) {
        m.walk.yaw += (e.clientX - ultimo.x) * 0.004;
        m.walk.pitch = THREE.MathUtils.clamp(m.walk.pitch + (e.clientY - ultimo.y) * 0.003, -1.2, 1.2);
        ultimo = { x: e.clientX, y: e.clientY };
      }
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        const c = acertar(e);
        renderer.domElement.style.cursor = c ? 'pointer' : 'grab';
        m.onHover?.(c, e.clientX, e.clientY);
      });
    };
    const onLeave = () => {
      abajo = null;
      m.onHover?.(null);
    };
    const enCampo = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName);
    const onKeyDown = (e) => {
      if (!m.walk.activo || enCampo(e) || !TECLAS[e.code]) return;
      e.preventDefault();
      m.walk.teclas.add(TECLAS[e.code]);
    };
    const onKeyUp = (e) => TECLAS[e.code] && m.walk.teclas.delete(TECLAS[e.code]);
    const onBlur = () => m.walk.teclas.clear();

    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      controls.dispose();
      liberar(scene);
      renderer.dispose();
      cont.removeChild(el);
      motor.current = null;
    };
  }, []);

  // Callbacks siempre al día sin recrear el motor
  useEffect(() => {
    if (!motor.current) return;
    motor.current.onSeleccionar = onSeleccionar;
    motor.current.onHover = onHover;
  }, [onSeleccionar, onHover]);

  // ---- Construir el almacén cuando cambia la configuración ----
  useEffect(() => {
    const m = motor.current;
    if (!m) return;
    if (m.grupo) {
      m.scene.remove(m.grupo);
      liberar(m.grupo);
    }
    const grupo = new THREE.Group();
    const { anchoPosicion: A, altoNivel: H, fondoRack: F } = cfg.medidas;
    const dist = distribucion(cfg);
    const catalogo = generarCatalogo(cfg);
    const racks = listaRacks(cfg);
    const xRack = Object.fromEntries(dist.racks.map((r) => [r.rack, r.x0]));
    const altoMax = alturaMaxima(cfg) * H;

    // Piso general
    const anchoTotal = dist.xMax - dist.xMin;
    const largoTotal = dist.zMax - dist.zMin;
    grupo.add(plano(anchoTotal + 10, largoTotal + 6, '#cbd5e1', (dist.xMin + dist.xMax) / 2, (dist.zMin + dist.zMax) / 2, 0));

    // Pasillos del almacén principal y de peligrosos
    const matLinea = new THREE.MeshBasicMaterial({ color: '#facc15' });
    const franjas = [
      ...dist.pasillos.map((p) => ({ ...p, z0: -0.5, z1: p.z1 ?? dist.largo + 0.5 })),
      ...(dist.medicos?.pasillos || []),
      ...(dist.peligrosos?.pasillos || []).map((p) => ({ ...p, z0: dist.peligrosos.z0 + 0.3, z1: dist.peligrosos.z1 - 0.3 })),
    ];
    franjas.forEach((p) => {
      const w = p.x1 - p.x0;
      const l = p.z1 - p.z0;
      const zc = (p.z0 + p.z1) / 2;
      grupo.add(plano(w, l, '#94a3b8', p.x0 + w / 2, zc, 0.005));
      [p.x0 + 0.1, p.x1 - 0.1].forEach((x) => {
        const linea = new THREE.Mesh(new THREE.PlaneGeometry(0.08, l), matLinea);
        linea.rotation.x = -Math.PI / 2;
        linea.position.set(x, 0.01, zc);
        grupo.add(linea);
      });
    });

    // ---------- Pasillos de atrás y túneles (franjas a lo ancho, en X) ----------
    const franjaX = (f, color = '#94a3b8', y = 0.006) => {
      const w = f.x1 - f.x0;
      grupo.add(plano(w, f.z1 - f.z0, color, (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, y));
      [f.z0 + 0.05, f.z1 - 0.05].forEach((z) => {
        const linea = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.08), matLinea);
        linea.rotation.x = -Math.PI / 2;
        linea.position.set((f.x0 + f.x1) / 2, y + 0.006, z);
        grupo.add(linea);
      });
    };
    dist.pasillosAtras.forEach((f) => franjaX(f));
    dist.tuneles.forEach((t) => {
      franjaX(t, '#a5b4c8', 0.009);
      const et = etiqueta(t.texto, { escala: 0.5, fondo: 'rgba(71,85,105,0.92)' });
      et.position.set(t.x0 + 1.2, 1.2, (t.z0 + t.z1) / 2);
      grupo.add(et);
    });

    // ---------- Pasillo al frente de los racks (llega a la puerta de peligrosos) ----------
    if (dist.frente) {
      const f = dist.frente;
      const w = f.x1 - f.x0;
      grupo.add(plano(w, f.z1 - f.z0, '#94a3b8', (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, 0.007));
      [f.z0 + 0.05, f.z1 - 0.05].forEach((z) => {
        const linea = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.08), matLinea);
        linea.rotation.x = -Math.PI / 2;
        linea.position.set((f.x0 + f.x1) / 2, 0.013, z);
        grupo.add(linea);
      });
    }

    // ---------- Stage y rampas (al frente) ----------
    if (dist.stage) {
      const s = dist.stage;
      const wS = s.x1 - s.x0;
      const lS = s.z1 - s.z0;
      grupo.add(plano(wS, lS, '#d1fae5', s.x0 + wS / 2, (s.z0 + s.z1) / 2, 0.006));
      // borde del stage
      const borde = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(wS, lS)),
        new THREE.LineBasicMaterial({ color: '#059669' }),
      );
      borde.rotation.x = -Math.PI / 2;
      borde.position.set(s.x0 + wS / 2, 0.02, (s.z0 + s.z1) / 2);
      grupo.add(borde);
      const tS = etiqueta('STAGE', { escala: 2.4, fondo: 'rgba(5,150,105,0.9)' });
      tS.position.set(s.x0 + wS / 2, 3.5, (s.z0 + s.z1) / 2);
      grupo.add(tS);

      // Muro del frente (translúcido) con portones y niveladoras de rampa
      const altoMuro = Math.max(altoMax + 2, 7);
      const matMuro = new THREE.MeshStandardMaterial({ color: '#e2e8f0', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const cortes = [s.x0 - 2, ...s.rampas.flatMap((r) => [r.xc - r.ancho / 2, r.xc + r.ancho / 2]), s.x1 + 2];
      for (let i = 0; i < cortes.length; i += 2) {
        const a = cortes[i];
        const b = cortes[i + 1];
        if (b - a < 0.05) continue;
        const muro = new THREE.Mesh(new THREE.BoxGeometry(b - a, altoMuro, 0.2), matMuro);
        muro.position.set((a + b) / 2, altoMuro / 2, s.z0);
        grupo.add(muro);
      }
      const altoPorton = 3.4;
      s.rampas.forEach((r) => {
        // dintel sobre el portón
        const dintel = new THREE.Mesh(new THREE.BoxGeometry(r.ancho, altoMuro - altoPorton, 0.2), matMuro);
        dintel.position.set(r.xc, altoPorton + (altoMuro - altoPorton) / 2, s.z0);
        grupo.add(dintel);
        // marco amarillo y negro del portón
        [-1, 1].forEach((lado) => grupo.add(caja(0.15, altoPorton, 0.3, '#facc15', r.xc + (lado * r.ancho) / 2, altoPorton / 2, s.z0)));
        grupo.add(caja(r.ancho + 0.3, 0.2, 0.3, '#facc15', r.xc, altoPorton, s.z0));
        // niveladora (rampa) hacia afuera, inclinada
        const rampa = caja(r.ancho * 0.85, 0.12, 2.6, '#475569', r.xc, 0.45, s.z0 - 1.3, { metalness: 0.4 });
        rampa.rotation.x = -0.12;
        grupo.add(rampa);
        // marca en el piso del stage frente a cada rampa
        grupo.add(plano(r.ancho * 0.85, Math.min(lS - 1, 8), '#a7f3d0', r.xc, s.z0 + Math.min(lS - 1, 8) / 2 + 0.3, 0.008));
        const tR = etiqueta(`R${r.numero}`, { escala: 1.3, fondo: 'rgba(30,41,59,0.9)' });
        tR.position.set(r.xc, altoPorton + 1, s.z0 + 0.3);
        grupo.add(tR);
      });
    }

    // ---------- Almacén de peligrosos (según el plano) ----------
    // Entre la pared del almacén y la puerta de ingreso: aire libre (sin piso, muros ni techo).
    // Zona roja: peligrosos, desde la línea de la puerta de ingreso hacia afuera.
    if (dist.peligrosos) {
      const p = dist.peligrosos;
      const lP = p.z1 - p.z0;
      const rojo = p.rojo;
      grupo.add(plano(rojo.x1 - rojo.x0, lP, '#fee2e2', (rojo.x0 + rojo.x1) / 2, (p.z0 + p.z1) / 2, 0.005));
      const altoMuro = Math.max(...cfg.peligrosos.racks.map((r) => r.niveles), 3) * H + 1.2;
      const matMuro = new THREE.MeshStandardMaterial({ color: '#dc2626', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
      const bordeRojo = new THREE.LineBasicMaterial({ color: '#b91c1c' });
      const bordeGris = new THREE.LineBasicMaterial({ color: '#475569' });
      const PUERTA = 2.4;
      // muro de a → b (en X o en Z), dejando huecos [h0, h1] para puertas
      const muro = (eje, fijo, a, b, huecos = [], mat = matMuro, alto = altoMuro) => {
        const matBorde = mat === matMuro ? bordeRojo : bordeGris; // otros materiales: borde gris
        const cortes = [a, ...huecos.flat(), b];
        for (let i = 0; i < cortes.length; i += 2) {
          const [c0, c1] = [cortes[i], cortes[i + 1]];
          if (c1 - c0 < 0.05) continue;
          const largo = c1 - c0;
          const m3 = new THREE.Mesh(new THREE.BoxGeometry(eje === 'x' ? largo : 0.2, alto, eje === 'x' ? 0.2 : largo), mat);
          m3.position.set(eje === 'x' ? (c0 + c1) / 2 : fijo, alto / 2, eje === 'x' ? fijo : (c0 + c1) / 2);
          grupo.add(m3);
          const borde = new THREE.LineSegments(new THREE.EdgesGeometry(m3.geometry), matBorde);
          borde.position.copy(m3.position);
          grupo.add(borde);
        }
        // dintel sobre cada puerta
        huecos.forEach(([h0, h1]) => {
          const dintel = new THREE.Mesh(new THREE.BoxGeometry(eje === 'x' ? h1 - h0 : 0.2, alto - 2.6, eje === 'x' ? 0.2 : h1 - h0), mat);
          dintel.position.set(eje === 'x' ? (h0 + h1) / 2 : fijo, 2.6 + (alto - 2.6) / 2, eje === 'x' ? fijo : (h0 + h1) / 2);
          grupo.add(dintel);
        });
      };
      const zPuerta = p.zPuerta;
      const hueco = [[zPuerta - PUERTA / 2, zPuerta + PUERTA / 2]];
      // Pasillo al aire libre: de la puerta del almacén a la puerta de peligrosos
      const pi = p.pasilloIngreso;
      if (pi) {
        const wI = pi.x1 - pi.x0;
        const lI = pi.z1 - pi.z0;
        grupo.add(plano(wI, lI, '#94a3b8', (pi.x0 + pi.x1) / 2, (pi.z0 + pi.z1) / 2, 0.006));
        [pi.z0 + 0.08, pi.z1 - 0.08].forEach((z) => {
          const linea = new THREE.Mesh(new THREE.PlaneGeometry(wI, 0.08), new THREE.MeshBasicMaterial({ color: '#facc15' }));
          linea.rotation.x = -Math.PI / 2;
          linea.position.set((pi.x0 + pi.x1) / 2, 0.012, z);
          grupo.add(linea);
        });
        // flechas en el piso hacia peligrosos
        const n = Math.max(1, Math.floor(wI / 2.2));
        for (let k = 0; k < n; k++) {
          const flecha = new THREE.Mesh(
            new THREE.CircleGeometry(0.35, 3),
            new THREE.MeshBasicMaterial({ color: '#ffffff' }),
          );
          flecha.rotation.set(-Math.PI / 2, 0, p.s < 0 ? Math.PI : 0); // apunta hacia afuera (a peligrosos)
          flecha.position.set(p.pared + p.s * (wI * (k + 0.5)) / n, 0.014, (pi.z0 + pi.z1) / 2);
          grupo.add(flecha);
        }
      }
      // Entre el almacén y peligrosos es aire libre (sin techo ni muros): solo se marcan las puertas.
      // Peligrosos (rojo): muro de la puerta de ingreso, frente, fondo y exterior
      muro('z', p.lineaIngreso, p.z0, p.z1, hueco);
      muro('x', p.z0, rojo.x0, rojo.x1);
      muro('x', p.z1, rojo.x0, rojo.x1);
      muro('z', p.exterior, p.z0, p.z1);
      // marcos de las dos puertas
      [[p.pared, 'Salida al almacén'], [p.lineaIngreso, 'Ingreso a peligrosos']].forEach(([xp, texto]) => {
        [-1, 1].forEach((l) => grupo.add(caja(0.25, 2.6, 0.12, '#facc15', xp, 1.3, zPuerta + (l * PUERTA) / 2)));
        grupo.add(caja(0.25, 0.15, PUERTA + 0.12, '#facc15', xp, 2.6, zPuerta));
        const t = etiqueta(texto, { escala: 0.8, fondo: 'rgba(30,41,59,0.9)' });
        t.position.set(xp, 3.1, zPuerta);
        grupo.add(t);
      });
      const tP = etiqueta('PELIGROSOS', { escala: 1.8, fondo: 'rgba(220,38,38,0.92)' });
      tP.position.set((rojo.x0 + rojo.x1) / 2, altoMuro + 1.6, p.z0 - 0.5);
      grupo.add(tP);
    }

    // ---------- Almacén de médicos (detrás de los racks 01–06) ----------
    if (dist.medicos) {
      const md = dist.medicos;
      grupo.add(plano(md.x1 - md.x0, md.z1 - md.z0, '#e0f2fe', (md.x0 + md.x1) / 2, (md.z0 + md.z1) / 2, 0.004));
      const alto = Math.max(...cfg.medicos.racks.map((r) => r.niveles), 3) * H + 1.2;
      const matM = new THREE.MeshStandardMaterial({ color: '#0284c7', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
      const bordeM = new THREE.LineBasicMaterial({ color: '#0369a1' });
      const PUERTA = 2.4;
      const muroM = (eje, fijo, a, b, huecos = []) => {
        const cortes = [a, ...huecos.flat(), b];
        for (let i = 0; i < cortes.length; i += 2) {
          const [c0, c1] = [cortes[i], cortes[i + 1]];
          if (c1 - c0 < 0.05) continue;
          const m3 = new THREE.Mesh(new THREE.BoxGeometry(eje === 'x' ? c1 - c0 : 0.2, alto, eje === 'x' ? 0.2 : c1 - c0), matM);
          m3.position.set(eje === 'x' ? (c0 + c1) / 2 : fijo, alto / 2, eje === 'x' ? fijo : (c0 + c1) / 2);
          grupo.add(m3);
          const borde = new THREE.LineSegments(new THREE.EdgesGeometry(m3.geometry), bordeM);
          borde.position.copy(m3.position);
          grupo.add(borde);
        }
        huecos.forEach(([h0, h1]) => {
          const dintel = new THREE.Mesh(new THREE.BoxGeometry(eje === 'x' ? h1 - h0 : 0.2, alto - 2.6, eje === 'x' ? 0.2 : h1 - h0), matM);
          dintel.position.set(eje === 'x' ? (h0 + h1) / 2 : fijo, 2.6 + (alto - 2.6) / 2, eje === 'x' ? fijo : (h0 + h1) / 2);
          grupo.add(dintel);
        });
      };
      const marcoX = (xc, z, texto) => {
        [-1, 1].forEach((l) => grupo.add(caja(0.12, 2.6, 0.25, '#facc15', xc + (l * PUERTA) / 2, 1.3, z)));
        grupo.add(caja(PUERTA + 0.12, 0.15, 0.25, '#facc15', xc, 2.6, z));
        const t = etiqueta(texto, { escala: 0.7, fondo: 'rgba(30,41,59,0.9)' });
        t.position.set(xc, 3.1, z);
        grupo.add(t);
      };
      const hueco = (xc) => [xc - PUERTA / 2, xc + PUERTA / 2];
      const c = md.cuarto;
      // muro de adelante con la puerta de ingreso y la "Puerta 1" del cuarto
      muroM('x', md.z0, md.x0, md.x1, [hueco(md.xPuerta), ...(c ? [hueco(c.xPuerta)] : [])].sort((a, b) => a[0] - b[0]));
      muroM('x', md.z1, md.x0, md.x1);
      muroM('z', md.x0, md.z0, md.z1);
      muroM('z', md.x1, md.z0, md.z1);
      marcoX(md.xPuerta, md.z0, 'Ingreso a médicos');
      if (c) {
        // cuarto de los racks 36 y 37: muro del lado de M1 y muro del fondo con puerta
        if (c.x0 > md.x0 + 0.3) muroM('z', c.x0, c.z0, c.z1);
        if (c.x1 < md.x1 - 0.3) muroM('z', c.x1, c.z0, c.z1);
        muroM('x', c.z1, c.x0, c.x1, [hueco(c.xPuerta)]);
        marcoX(c.xPuerta, md.z0, 'Puerta 1');
        marcoX(c.xPuerta, c.z1, 'Puerta');
      }
      const tM = etiqueta('MÉDICOS', { escala: 1.8, fondo: 'rgba(3,105,161,0.92)' });
      tM.position.set((md.x0 + md.x1) / 2, alto + 1.6, md.z1 + 0.5);
      grupo.add(tM);
    }

    // ---------- Datos de cada profundidad ----------
    const infos = {};
    racks.forEach((r) => {
      infos[r] = {};
      const [pD, pH] = rangoProfundidades(cfg, r);
      for (let p = pD; p <= pH; p++) infos[r][p] = infoProfundidad(cfg, r, p);
    });

    // ---------- Estructura: parantes y vigas ----------
    let nParantes = 0;
    let nVigas = 0;
    racks.forEach((r) => {
      const [pD, pH] = rangoProfundidades(cfg, r);
      nParantes += (pH - pD + 2 + columnasDeRack(cfg, r).length) * 2 + 20;
      for (let p = pD; p <= pH; p++) {
        const i = infos[r][p];
        if (!i.inactiva) nVigas += (i.niveles - i.desde + 2) * 2;
      }
    });
    const geoCaja = new THREE.BoxGeometry(1, 1, 1);
    const parantes = new THREE.InstancedMesh(geoCaja, new THREE.MeshStandardMaterial({ color: COLOR_ESTRUCTURA, metalness: 0.3, roughness: 0.6 }), Math.max(nParantes, 1));
    const vigas = new THREE.InstancedMesh(geoCaja, new THREE.MeshStandardMaterial({ color: COLOR_VIGA, roughness: 0.6 }), Math.max(nVigas, 1));
    const tmp = new THREE.Object3D();
    let ip = 0;
    let iv = 0;
    racks.forEach((r) => {
      const [pD, pH] = rangoProfundidades(cfg, r);
      const x0 = xRack[r];
      const alto = (p) => {
        const a = infos[r][p];
        return a && !a.inactiva ? a.altura : 0;
      };
      // libre abajo por puente (0 si no hay puente)
      const libre = (p) => {
        const a = infos[r][p];
        return a && !a.inactiva && a.puente ? a.libres : 0;
      };
      const parante = (z, h, y0 = 0) => {
        const hp = Math.max(h - y0, 0.01);
        [x0 + 0.04, x0 + F - 0.04].forEach((x) => {
          tmp.position.set(x, y0 + hp / 2, z * A);
          tmp.scale.set(0.08, hp, 0.08);
          tmp.updateMatrix();
          parantes.setMatrixAt(ip++, tmp.matrix);
        });
      };
      // puentes con ubicaciones anchas: sin parantes intermedios por profundidad, sino en los bordes de cada ubicación
      const anchoEn = (p) => {
        const a = infos[r][p];
        return a && !a.inactiva && (a.span.n > 1 || a.sinArriba);
      };
      for (let p = pD; p <= pH; p++) {
        const a = infos[r][p];
        if (a.inactiva || a.span.n <= 1 || a.span.k !== 0) continue;
        for (let k = 1; k < a.span.n; k++) parante(a.span.inicio + k * a.span.ancho, a.altura * H, a.libres * H);
      }
      for (let b = pD - 1; b <= pH; b++) {
        if (anchoEn(b) && anchoEn(b + 1) && infos[r][b].puente && infos[r][b + 1].puente) continue;
        const sB = infos[r][b]?.span;
        const sB1 = infos[r][b + 1]?.span;
        const zFin = b >= pD ? sB.inicio + sB.ancho : null; // donde termina b
        const zIni = b + 1 <= pH ? sB1.inicio : null; // donde empieza b+1
        if (zFin != null && zIni != null && Math.abs(zFin - zIni) > 0.001) {
          // hay una columna en medio: cada lado lleva su propio parante
          parante(zFin, alto(b) * H || 0.01);
          parante(zIni, alto(b + 1) * H || 0.01);
          continue;
        }
        const h = Math.max(alto(b), alto(b + 1)) * H || 0.01;
        // Entre dos profundidades del mismo puente no hay parante en el paso de personas:
        // arranca arriba del paso libre. En los bordes del puente sí llega al piso.
        parante(zFin ?? zIni, h, Math.min(libre(b), libre(b + 1)) * H);
      }
      for (let p = pD; p <= pH; p++) {
        const i = infos[r][p];
        if (i.inactiva || i.sinArriba) continue;
        const ys = [];
        for (let n = i.desde; n <= i.niveles; n++) ys.push(i.bases[n - 1] * H);
        ys.push(i.altura * H);
        ys.forEach((y0) => {
          const y = y0 < 0.01 ? 0.08 : y0;
          [x0 + 0.04, x0 + F - 0.04].forEach((x) => {
            tmp.position.set(x, y, (i.span.inicio + i.span.ancho / 2) * A);
            tmp.scale.set(0.07, 0.12, i.span.ancho * A - 0.04);
            tmp.updateMatrix();
            vigas.setMatrixAt(iv++, tmp.matrix);
          });
        });
      }
    });
    parantes.count = ip;
    vigas.count = iv;
    grupo.add(parantes, vigas);

    // ---------- Cargas + cajas invisibles de clic ----------
    // Cada ubicación lleva 1 a 4 pallets, uno al lado del otro a lo largo de la profundidad.
    const total = Math.max(catalogo.length, 1);
    const totalPallets = Math.max(catalogo.reduce((s, u) => s + (u.pallets || 1), 0), 1);
    const cargas = new THREE.InstancedMesh(geoCaja, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), totalPallets);
    const clic = new THREE.InstancedMesh(geoCaja, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), total);
    let ic = 0;
    clic.count = catalogo.length;
    cargas.frustumCulled = false;
    clic.frustumCulled = false;
    const cero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    const hayOcupacion = Object.keys(ocupacion).length > 0;
    const cajas = {};
    catalogo.forEach((u, i) => {
      const info = infos[u.rack][u.prof];
      const cx = xRack[u.rack] + F / 2;
      const cy = info.bases[u.nivel - 1] * H;
      const hN = info.alturas[u.nivel - 1] * H;
      const cz = (info.span.inicio + info.span.ancho / 2) * A;
      const lU = info.span.ancho * A; // largo de la ubicación (más largo si es ancha sobre un puente)
      cajas[u.codigo] = { y0: cy, h: hN, z: cz, l: lU };
      tmp.position.set(cx, cy + hN / 2, cz);
      tmp.scale.set(F, hN, lU);
      tmp.updateMatrix();
      clic.setMatrixAt(i, tmp.matrix);

      const dato = ocupacion[u.codigo];
      const np = u.pallets || 1;
      if (hayOcupacion && !dato) {
        for (let k = 0; k < np; k++) {
          cargas.setMatrixAt(ic, cero);
          cargas.setColorAt(ic++, COLOR_VACIA);
        }
        return;
      }
      const hc = Math.max(hN - 0.3, hN * 0.6);
      const anchoP = lU / np;
      if (hayOcupacion && modoColor === 'cliente') col.set(colorCliente(clientes, dato.cliente));
      else col.copy(zonaDe(cfg, u.rack) === 'peligrosos' ? COLOR_CARTON_PEL : COLOR_CARTON);
      for (let k = 0; k < np; k++) {
        tmp.position.set(cx, cy + 0.14 + hc / 2, cz - lU / 2 + anchoP * (k + 0.5));
        tmp.scale.set(F * 0.85, hc, anchoP * 0.85);
        tmp.updateMatrix();
        cargas.setMatrixAt(ic, tmp.matrix);
        cargas.setColorAt(ic++, col);
      }
    });
    cargas.count = ic;
    if (cargas.instanceColor) cargas.instanceColor.needsUpdate = true;
    grupo.add(cargas, clic);

    // ---------- Enrejados: jaula de malla alrededor de la profundidad ----------
    const enrejadas = [];
    racks.forEach((r) => {
      const [pD, pH] = rangoProfundidades(cfg, r);
      for (let p = pD; p <= pH; p++) if (infos[r][p].enrejado && !infos[r][p].inactiva) enrejadas.push([r, p]);
    });
    if (enrejadas.length) {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const g = cv.getContext('2d');
      g.strokeStyle = '#334155';
      g.lineWidth = 3;
      for (let k = 0; k <= 64; k += 16) {
        g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 64); g.stroke();
        g.beginPath(); g.moveTo(0, k); g.lineTo(64, k); g.stroke();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 6);
      const malla = new THREE.InstancedMesh(
        geoCaja,
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false }),
        enrejadas.length,
      );
      enrejadas.forEach(([r, p], i) => {
        const inf = infos[r][p];
        const hn = inf.enrejadoHasta && inf.enrejadoHasta <= inf.niveles ? inf.enrejadoHasta : null;
        const alto = (hn ? inf.bases[hn - 1] + inf.alturas[hn - 1] : inf.altura) * H; // hasta el nivel indicado
        tmp.position.set(xRack[r] + F / 2, alto / 2, (filaDe(cfg, r, p) - 0.5) * A);
        tmp.scale.set(F + 0.08, alto, A - 0.02);
        tmp.updateMatrix();
        malla.setMatrixAt(i, tmp.matrix);
      });
      grupo.add(malla);
    }

    // ---------- Columnas del edificio (cortan el rack) ----------
    const matColumna = new THREE.MeshStandardMaterial({ color: '#6b7280', metalness: 0.5, roughness: 0.5 });
    const altoTecho = Math.max(altoMax + 2, 7);
    racks.forEach((r) => {
      const [pD, pH] = rangoProfundidades(cfg, r);
      columnasDeRack(cfg, r).forEach((k) => {
        if (k.desde > filaDe(cfg, r, pH) || pD > pH) return; // fuera del rack
        const z0 = inicioColumna(cfg, r, k) * A;
        const lz = k.ocupa * A;
        if (k.tipo === 'muro') {
          // muro: corta todo el fondo del rack
          grupo.add(caja(F + 0.1, altoTecho, lz - 0.05, '#cbd5e1', xRack[r] + F / 2, altoTecho / 2, z0 + lz / 2));
          return;
        }
        const col3 = new THREE.Mesh(new THREE.BoxGeometry(Math.min(F * 0.6, 0.7), altoTecho, Math.min(lz * 0.6, 0.8)), matColumna);
        col3.position.set(xRack[r] + F / 2, altoTecho / 2, z0 + lz / 2);
        grupo.add(col3);
        // base naranja como en la foto
        grupo.add(caja(Math.min(F * 0.6, 0.7) + 0.12, 0.5, Math.min(lz * 0.6, 0.7) + 0.12, '#f97316', xRack[r] + F / 2, 0.25, z0 + lz / 2));
      });
    });

    // ---------- Rótulos de rack (cartel con flecha hacia el pasillo) ----------
    if (cfg.rotulos?.activo) {
      const geoRot = new THREE.PlaneGeometry(Math.min(F * 0.95, 1.1), Math.min(F * 0.95, 1.1) * 0.625);
      const hRot = Math.max(+cfg.rotulos.altura || 4.5, 1);
      racks.forEach((r) => {
        const [pD, pH] = rangoProfundidades(cfg, r);
        const lado = ladoDe(cfg, dist, r);
        const x = xRack[r] + F / 2;
        const alto = Math.max(infos[r][pD]?.altura ?? 1, 1) * H;
        const y = Math.min(hRot, alto - 0.4);
        const caras = [{ z: (filaDe(cfg, r, pD) - 1) * A - 0.06, frente: true }];
        if (cfg.rotulos.atras) caras.push({ z: filaDe(cfg, r, pH) * A + 0.06, frente: false });
        caras.forEach(({ z, frente }) => {
          // Al frente se mira hacia +Z: la derecha es X menor. Atrás es al revés.
          const flechaDerecha = frente ? lado < 0 : lado > 0;
          const mat = new THREE.MeshBasicMaterial({ map: texturaRotulo(codRack(r), flechaDerecha), side: THREE.FrontSide });
          const cartel = new THREE.Mesh(geoRot, mat);
          cartel.position.set(x, y, z);
          if (frente) cartel.rotation.y = Math.PI;
          grupo.add(cartel);
          // reverso gris
          const reverso = new THREE.Mesh(geoRot, new THREE.MeshBasicMaterial({ color: '#94a3b8' }));
          reverso.position.set(x, y, z + (frente ? 0.01 : -0.01));
          if (!frente) reverso.rotation.y = Math.PI;
          grupo.add(reverso);
        });
      });
    }

    // ---------- Apiladores en los pasillos ----------
    dist.apiladores.forEach((a) => {
      const ap = crearApilador();
      ap.position.set(a.x, 0, a.z);
      if (a.mira < 0) ap.rotation.y = Math.PI;
      grupo.add(ap);
      const t = etiqueta(`Apilador ${a.numero}`, { escala: 0.55, fondo: 'rgba(180,83,9,0.92)' });
      t.position.set(a.x, 3.2, a.z);
      grupo.add(t);
    });

    // ---------- Etiquetas de rack y de puentes ----------
    racks.forEach((r) => {
      const x = xRack[r] + F / 2;
      const [pD, pH] = rangoProfundidades(cfg, r);
      const pel = esRackPeligrosos(r);
      const yEt = (pel ? infos[r][pD].altura * H : altoMax) + 2.2; // bien arriba del rack
      [(filaDe(cfg, r, pD) - 1) * A - 1.2, filaDe(cfg, r, pH) * A + 1.2].forEach((z) => {
        const zona = zonaDe(cfg, r);
        const s = etiqueta(codRack(r), zona === 'peligrosos' ? { fondo: 'rgba(185,28,28,0.92)' } : zona === 'medicos' ? { fondo: 'rgba(3,105,161,0.92)' } : undefined);
        s.position.set(x, Math.max(yEt, 2.5), z);
        grupo.add(s);
      });
    });
    cfg.puentes.forEach((b) => {
      const t = b.desde === b.hasta ? `Puente ${codProf(b.desde)}` : `Puente ${codProf(b.desde)}-${codProf(b.hasta)}`;
      const s = etiqueta(t, { escala: 0.6, fondo: 'rgba(180,83,9,0.92)' });
      // racks a los que aplica: los nombrados, o todos los del almacén principal
      const aplica = b.racks?.length ? racks.filter((r) => b.racks.some((x) => String(x) === String(r))) : [];
      if (aplica.length) {
        const xs = aplica.map((r) => xRack[r] + F / 2);
        const r0 = aplica[0];
        const fD = esRackPeligrosos(r0) ? filaDe(cfg, r0, b.desde) : b.desde; // principal: posición física
        const fH = esRackPeligrosos(r0) ? filaDe(cfg, r0, b.hasta) : b.hasta;
        const zc = ((fD + fH) / 2 - 0.5) * A;
        s.position.set((Math.min(...xs) + Math.max(...xs)) / 2, Math.max(b.nivelesLibres * H - 0.3, 0.5), zc);
      } else {
        const p0 = dist.pasillos[0];
        s.position.set((p0.x0 + p0.x1) / 2, 1.4, ((b.desde + b.hasta) / 2 - 0.5) * A);
      }
      grupo.add(s);
    });

    m.scene.add(grupo);
    m.grupo = grupo;
    m.clic = clic;
    m.codigos = catalogo.map((u) => u.codigo);
    m.indice = Object.fromEntries(catalogo.map((u, i) => [u.codigo, i]));
    m.dims = { F, H, A, xRack, cajas, dist };
    m.walk.limites = { x0: dist.xMin - 4, x1: dist.xMax + 4, z0: dist.zMin - 4, z1: dist.zMax + 4 };

    // Cámara inicial: desde el frente (lado del stage), mirando hacia el fondo
    const centro = new THREE.Vector3((dist.xMin + dist.xMax) / 2, 0, (dist.zMin + dist.zMax) / 2);
    if (!m.camaraLista || m.centro.distanceTo(centro) > 5) {
      m.centro.copy(centro);
      const d = Math.max(anchoTotal, largoTotal);
      m.camera.position.set(centro.x + d * 0.1, d * 0.5, dist.zMin - d * 0.35);
      m.controls.target.copy(centro);
      m.camaraLista = true;
    }
  }, [cfg, ocupacion, clientes, modoColor]);

  // ---- Lleva la cámara (a pie) al pasillo frente a una ubicación ----
  const pararseFrente = (m, cod) => {
    const { rack: r, p } = (() => {
      const [a, b] = cod.split('-');
      return { rack: leerRack(a), p: +b };
    })();
    const { F, A, xRack } = m.dims;
    const P = cfg.medidas.pasillo;
    const lado = ladoPasillo(m, r);
    const xPasillo = lado < 0 ? xRack[r] - P / 2 : xRack[r] + F + P / 2;
    m.camera.position.set(xPasillo, ALTURA_OJOS, (filaDe(cfg, r, p) - 0.5) * A - 2.2);
    m.walk.yaw = Math.atan2(-lado * (P / 2 + F / 2), 2.2); // mirando a la posición en diagonal
    m.walk.pitch = 0;
  };

  const ladoPasillo = (m, r) => ladoDe(cfg, m.dims.dist, r);

  // ---- Marcar la ubicación seleccionada y llevar la cámara ----
  useEffect(() => {
    const m = motor.current;
    if (!m || !m.dims) return;
    if (!seleccion || m.indice?.[seleccion] == null) {
      m.marca.visible = false;
      return;
    }
    const [a, b] = seleccion.split('-');
    const r = leerRack(a);
    const p = +b;
    const { F, A, xRack, cajas } = m.dims;
    const c = cajas[seleccion];
    const pos = new THREE.Vector3(xRack[r] + F / 2, c.y0 + c.h / 2, c.z ?? (filaDe(cfg, r, p) - 0.5) * A);
    m.marca.position.copy(pos);
    m.marca.scale.set(F + 0.1, c.h + 0.05, (c.l ?? A) + 0.05);
    m.marca.visible = true;
    if (m.ultimaSel === seleccion) return;
    m.ultimaSel = seleccion;
    if (m.walk.activo) {
      pararseFrente(m, seleccion);
      return;
    }
    const P = cfg.medidas.pasillo;
    const xPasillo = ladoPasillo(m, r) < 0 ? xRack[r] - P / 2 : xRack[r] + F + P / 2;
    m.controls.target.copy(pos);
    m.camera.position.set(xPasillo, Math.max(pos.y + 0.6, ALTURA_OJOS), pos.z - Math.max(4, c.h * 2.5));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion, cfg, ocupacion]);

  // ---- Entrar / salir del modo caminar ----
  useEffect(() => {
    const m = motor.current;
    if (!m || !m.dims) return;
    const w = m.walk;
    if (w.activo === caminando) return; // al montar no hay cambio de modo
    w.activo = caminando;
    w.teclas.clear();
    m.controls.enabled = !caminando;
    if (caminando) {
      m.scene.fog = new THREE.Fog('#eef2f7', 25, 110);
      if (seleccion && m.indice?.[seleccion] != null) pararseFrente(m, seleccion);
      else {
        // entrada del primer pasillo, desde el stage, mirando al fondo
        const p0 = m.dims.dist.pasillos[0];
        m.camera.position.set((p0.x0 + p0.x1) / 2, ALTURA_OJOS, -3);
        w.yaw = 0;
        w.pitch = 0;
      }
    } else {
      m.scene.fog = null;
      const dirV = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw));
      m.controls.target.copy(m.camera.position).addScaledVector(dirV, 8);
      m.controls.target.y = 0;
      m.controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caminando]);

  // Botones táctiles: mantener apretado = mantener la tecla
  const boton = (accion, texto, titulo) => (
    <button type="button" title={titulo}
      onPointerDown={(e) => { e.preventDefault(); motor.current?.walk.teclas.add(accion); }}
      onPointerUp={() => motor.current?.walk.teclas.delete(accion)}
      onPointerLeave={() => motor.current?.walk.teclas.delete(accion)}>{texto}</button>
  );

  return (
    <div className="alm-3d-cont">
      <div ref={contRef} className="alm-3d" />
      <div className="alm-3d-barra">
        <button type="button" className={`alm-btn ${caminando ? '' : 'alm-btn-sec'}`} onClick={() => setCaminando((v) => !v)}>
          {caminando ? '🛩 Vista aérea' : '🚶 Caminar'}
        </button>
      </div>
      {caminando ? (
        <>
          <div className="alm-3d-pad">
            <span />{boton('adelante', '▲', 'Avanzar (↑ / W)')}<span />
            {boton('izq', '◀', 'Girar izquierda (← / A)')}{boton('atras', '▼', 'Retroceder (↓ / S)')}{boton('der', '▶', 'Girar derecha (→ / D)')}
          </div>
          <div className="alm-3d-pad alm-3d-pad-alt">
            {boton('subir', '⤒', 'Subir (E)')}{boton('bajar', '⤓', 'Bajar (Q)')}
          </div>
          <div className="alm-3d-ayuda">↑↓ / W S caminar (mantén para acelerar) · ←→ / A D girar · arrastra para mirar · E/Q subir y bajar · clic en una ubicación para verla</div>
        </>
      ) : (
        <div className="alm-3d-ayuda">Arrastra para girar · rueda para zoom · clic derecho para mover · “Caminar” para recorrer a pie</div>
      )}
    </div>
  );
}
