import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { alturaMaxima, codProf, colorCliente, distribucion, generarCatalogo, infoProfundidad, pasilloAntesDe, profundidadesDeRack, codRack } from './almacenModelo';

// Vista 3D del almacén.
// - Una sola InstancedMesh para todas las cargas (miles de posiciones en una llamada de dibujo).
// - Posición vacía = escala 0 (no se borra), así cambiar ocupación es solo reescribir matrices.
// - Caja invisible por ubicación para el clic (funciona también en vacías).
// Ejes: X = racks uno al lado del otro, Z = profundidad, Y = altura.

const COLOR_CARTON = new THREE.Color('#c8a165');
const COLOR_VACIA = new THREE.Color('#e2e8f0');
const COLOR_ESTRUCTURA = '#1d4ed8';
const COLOR_VIGA = '#f97316';

const etiqueta = (texto, escala = 1) => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(15,23,42,0.85)';
  g.beginPath();
  g.roundRect(4, 4, 120, 56, 12);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 34px Segoe UI, Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texto, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(1.6 * escala, 0.8 * escala, 1);
  s.renderOrder = 10;
  return s;
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

export default function Vista3D({ cfg, ocupacion, clientes, modoColor, seleccion, onSeleccionar, onHover }) {
  const contRef = useRef(null);
  const motor = useRef(null); // { renderer, scene, camera, controls, grupo, codigos, clic, marca }

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

    const camera = new THREE.PerspectiveCamera(50, cont.clientWidth / cont.clientHeight, 0.1, 3000);
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

    const m = { renderer, scene, camera, controls, grupo: null, codigos: [], clic: null, marca, centro: new THREE.Vector3() };
    motor.current = m;

    let raf;
    const loop = () => {
      controls.update();
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
    const onDown = (e) => (abajo = { x: e.clientX, y: e.clientY, t: Date.now() });
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
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        const c = acertar(e);
        renderer.domElement.style.cursor = c ? 'pointer' : 'grab';
        m.onHover?.(c, e.clientX, e.clientY);
      });
    };
    const onLeave = () => m.onHover?.(null);
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
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
    const xRack = Object.fromEntries(dist.racks.map((r) => [r.rack, r.x0]));

    // Piso y pasillos
    const piso = new THREE.Mesh(
      new THREE.PlaneGeometry(dist.ancho + 8, dist.largo + 12),
      new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.95 }),
    );
    piso.rotation.x = -Math.PI / 2;
    piso.position.set(dist.ancho / 2, 0, dist.largo / 2);
    grupo.add(piso);
    const matPasillo = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 1 });
    const matLinea = new THREE.MeshBasicMaterial({ color: '#facc15' });
    dist.pasillos.forEach((p) => {
      const w = p.x1 - p.x0;
      const franja = new THREE.Mesh(new THREE.PlaneGeometry(w, dist.largo + 4), matPasillo);
      franja.rotation.x = -Math.PI / 2;
      franja.position.set(p.x0 + w / 2, 0.005, dist.largo / 2);
      grupo.add(franja);
      [p.x0 + 0.1, p.x1 - 0.1].forEach((x) => {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(0.08, dist.largo + 4), matLinea);
        l.rotation.x = -Math.PI / 2;
        l.position.set(x, 0.01, dist.largo / 2);
        grupo.add(l);
      });
    });

    // Datos de cada profundidad (una sola vez)
    const infos = {};
    for (let r = 1; r <= cfg.racks; r++) {
      infos[r] = [];
      const profs = profundidadesDeRack(cfg, r);
      for (let p = 1; p <= profs; p++) infos[r][p] = infoProfundidad(cfg, r, p);
    }

    // Estructura: parantes en cada límite de profundidad (2 por límite: frente y fondo)
    let nParantes = 0;
    let nVigas = 0;
    for (let r = 1; r <= cfg.racks; r++) {
      const profs = profundidadesDeRack(cfg, r);
      nParantes += (profs + 1) * 2;
      for (let p = 1; p <= profs; p++) {
        const i = infos[r][p];
        if (!i.inactiva) nVigas += (i.niveles - i.desde + 2) * 2;
      }
    }
    const geoCaja = new THREE.BoxGeometry(1, 1, 1);
    const parantes = new THREE.InstancedMesh(geoCaja, new THREE.MeshStandardMaterial({ color: COLOR_ESTRUCTURA, metalness: 0.3, roughness: 0.6 }), nParantes);
    const vigas = new THREE.InstancedMesh(geoCaja, new THREE.MeshStandardMaterial({ color: COLOR_VIGA, roughness: 0.6 }), nVigas);
    const tmp = new THREE.Object3D();
    let ip = 0;
    let iv = 0;
    for (let r = 1; r <= cfg.racks; r++) {
      const profs = profundidadesDeRack(cfg, r);
      const x0 = xRack[r];
      // la altura del rack es fija; parante = altura de las profundidades vecinas
      const alto = (p) => {
        const a = p >= 1 && p <= profs ? infos[r][p] : null;
        return a && !a.inactiva ? a.altura : 0;
      };
      for (let b = 0; b <= profs; b++) {
        const h = Math.max(alto(b), alto(b + 1)) * H || 0.01;
        [x0 + 0.04, x0 + F - 0.04].forEach((x) => {
          tmp.position.set(x, h / 2, b * A);
          tmp.scale.set(0.08, h, 0.08);
          tmp.updateMatrix();
          parantes.setMatrixAt(ip++, tmp.matrix);
        });
      }
      for (let p = 1; p <= profs; p++) {
        const i = infos[r][p];
        if (i.inactiva) continue;
        // una viga en la base de cada nivel que existe + una arriba del todo
        const ys = [];
        for (let n = i.desde; n <= i.niveles; n++) ys.push(i.bases[n - 1] * H);
        ys.push(i.altura * H);
        ys.forEach((y0) => {
          const y = y0 < 0.01 ? 0.08 : y0;
          [x0 + 0.04, x0 + F - 0.04].forEach((x) => {
            tmp.position.set(x, y, (p - 0.5) * A);
            tmp.scale.set(0.07, 0.12, A - 0.04);
            tmp.updateMatrix();
            vigas.setMatrixAt(iv++, tmp.matrix);
          });
        });
      }
    }
    parantes.count = ip;
    vigas.count = iv;
    grupo.add(parantes, vigas);

    // Cargas + cajas invisibles de clic
    const cargas = new THREE.InstancedMesh(geoCaja, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), catalogo.length);
    const clic = new THREE.InstancedMesh(geoCaja, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), catalogo.length);
    cargas.frustumCulled = false;
    clic.frustumCulled = false;
    const cero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    const hayOcupacion = Object.keys(ocupacion).length > 0;
    const caja = {}; // código → { y0, h } en metros (para la marca)
    catalogo.forEach((u, i) => {
      const info = infos[u.rack][u.prof];
      const cx = xRack[u.rack] + F / 2;
      const cy = info.bases[u.nivel - 1] * H;
      const hN = info.alturas[u.nivel - 1] * H;
      const cz = (u.prof - 0.5) * A;
      caja[u.codigo] = { y0: cy, h: hN };
      tmp.position.set(cx, cy + hN / 2, cz);
      tmp.scale.set(F, hN, A);
      tmp.updateMatrix();
      clic.setMatrixAt(i, tmp.matrix);

      const dato = ocupacion[u.codigo];
      if (hayOcupacion && !dato) {
        cargas.setMatrixAt(i, cero);
        cargas.setColorAt(i, COLOR_VACIA);
        return;
      }
      const hc = Math.max(hN - 0.3, hN * 0.6);
      tmp.position.set(cx, cy + 0.14 + hc / 2, cz);
      tmp.scale.set(F * 0.85, hc, A * 0.85);
      tmp.updateMatrix();
      cargas.setMatrixAt(i, tmp.matrix);
      if (!hayOcupacion) col.copy(COLOR_CARTON);
      else if (modoColor === 'cliente') col.set(colorCliente(clientes, dato.cliente));
      else col.copy(COLOR_CARTON);
      cargas.setColorAt(i, col);
    });
    if (cargas.instanceColor) cargas.instanceColor.needsUpdate = true;
    grupo.add(cargas, clic);

    // Etiquetas de rack (adelante y atrás) y de puentes
    const altoMax = alturaMaxima(cfg) * H;
    for (let r = 1; r <= cfg.racks; r++) {
      const x = xRack[r] + F / 2;
      const profs = profundidadesDeRack(cfg, r);
      [-1.2, profs * A + 1.2].forEach((z) => {
        const s = etiqueta(codRack(r));
        s.position.set(x, altoMax + 0.9, z);
        grupo.add(s);
      });
    }
    cfg.puentes.forEach((b) => {
      const t = b.desde === b.hasta ? `P ${codProf(b.desde)}` : `P ${codProf(b.desde)}-${codProf(b.hasta)}`;
      const s = etiqueta(t, 1.3);
      s.scale.x *= b.desde === b.hasta ? 1 : 1.8;
      s.position.set(-3, 1.2, ((b.desde + b.hasta) / 2 - 0.5) * A);
      grupo.add(s);
    });

    m.scene.add(grupo);
    m.grupo = grupo;
    m.clic = clic;
    m.codigos = catalogo.map((u) => u.codigo);
    m.indice = Object.fromEntries(catalogo.map((u, i) => [u.codigo, i]));
    m.dims = { F, H, A, xRack, caja };

    // Cámara inicial (solo la primera vez o si cambió mucho el tamaño)
    const centro = new THREE.Vector3(dist.ancho / 2, 0, dist.largo / 2);
    if (!m.camaraLista || m.centro.distanceTo(centro) > 5) {
      m.centro.copy(centro);
      const d = Math.max(dist.ancho, dist.largo);
      m.camera.position.set(dist.ancho / 2 - d * 0.15, d * 0.55, dist.largo + d * 0.45);
      m.controls.target.copy(centro);
      m.camaraLista = true;
    }
  }, [cfg, ocupacion, clientes, modoColor]);

  // ---- Marcar la ubicación seleccionada y llevar la cámara ----
  useEffect(() => {
    const m = motor.current;
    if (!m || !m.dims) return;
    if (!seleccion || m.indice?.[seleccion] == null) {
      m.marca.visible = false;
      return;
    }
    const [r, p] = seleccion.split('-').map(Number);
    const { F, H, A, xRack, caja } = m.dims;
    const c = caja[seleccion];
    const pos = new THREE.Vector3(xRack[r] + F / 2, c.y0 + c.h / 2, (p - 0.5) * A);
    m.marca.position.copy(pos);
    m.marca.scale.set(F + 0.1, c.h + 0.05, A + 0.05);
    m.marca.visible = true;
    // Cámara al centro del pasillo que da a la posición (solo si cambió la selección)
    if (m.ultimaSel === seleccion) return;
    m.ultimaSel = seleccion;
    const P = cfg.medidas.pasillo;
    const xPasillo = pasilloAntesDe(cfg, r) ? xRack[r] - P / 2 : xRack[r] + F + P / 2;
    m.controls.target.copy(pos);
    m.camera.position.set(xPasillo, Math.max(pos.y + 0.6, 1.65), pos.z + Math.max(4, H * 2.5));
  }, [seleccion, cfg, ocupacion]);

  return <div ref={contRef} className="alm-3d" />;
}
