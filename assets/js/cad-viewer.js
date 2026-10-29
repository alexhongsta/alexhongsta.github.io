// On-demand STEP viewer. Nothing heavy loads until a visitor asks for a model.
const OCCT_BASE = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';

let occtPromise = null;
function loadOcct() {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OCCT_BASE + 'occt-import-js.js';
      s.onload = () => resolve(window.occtimportjs({ locateFile: (f) => OCCT_BASE + f }));
      s.onerror = () => reject(new Error('STEP parser failed to load'));
      document.head.appendChild(s);
    });
  }
  return occtPromise;
}

async function open(box) {
  const status = box.querySelector('.cad-status');
  const button = box.querySelector('.cad-open');
  button.disabled = true;
  status.textContent = 'LOADING MODEL…';

  try {
    const [THREE, { OrbitControls }, occt, step] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
      loadOcct(),
      fetch(box.dataset.src).then((r) => {
        if (!r.ok) throw new Error('STEP file missing');
        return r.arrayBuffer();
      }),
    ]);

    const result = occt.ReadStepFile(new Uint8Array(step), null);
    if (!result.success) throw new Error('STEP file could not be read');

    const ink = new THREE.Color('#17171A');
    const group = new THREE.Group();
    for (const m of result.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      else geo.computeVertexNormals();
      geo.setIndex(new THREE.Uint32BufferAttribute(m.index.array, 1));
      const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color('#B9B9B2');
      group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color, roughness: 0.75, metalness: 0.05,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      })));
      group.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.35 })
      ));
    }

    const stage = box.querySelector('.cad-stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#F1F1EC');
    stage.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', box.dataset.label || '3D model');

    const scene = new THREE.Scene();
    scene.add(group);
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a85', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    scene.add(key);

    // Fusion exports Z-up.
    const box3 = new THREE.Box3().setFromObject(group);
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, sphere.radius / 100, sphere.radius * 100);
    camera.up.set(0, 0, 1);
    const dir = new THREE.Vector3(1, -1.6, 0.9).normalize();
    const corners = [];
    for (const x of [box3.min.x, box3.max.x]) for (const y of [box3.min.y, box3.max.y]) for (const z of [box3.min.z, box3.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const fit = (aspect) => {
      camera.aspect = aspect;
      let dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15));
      for (let i = 0; i < 3; i++) {
        camera.position.copy(sphere.center).addScaledVector(dir, dist);
        camera.lookAt(sphere.center);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        let extent = 0;
        for (const c of corners) {
          const p = c.clone().project(camera);
          extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
        }
        dist *= extent / 0.85;
      }
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(sphere.center);
    let fitted = false;

    const render = () => {
      key.position.copy(camera.position);
      renderer.render(scene, camera);
    };
    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      if (!fitted) { fit(w / h); fitted = true; }
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls.update();
      render();
    };
    controls.addEventListener('change', render);
    new ResizeObserver(resize).observe(stage);

    box.classList.add('is-open');
    button.hidden = true;
    status.textContent = 'DRAG TO ROTATE · SCROLL TO ZOOM · RIGHT-DRAG TO PAN';
  } catch (err) {
    button.disabled = false;
    status.textContent = 'COULDN’T LOAD THE VIEWER. THE STEP FILE BELOW STILL DOWNLOADS.';
  }
}

document.querySelectorAll('.cad').forEach((box) => {
  box.hidden = false;
  box.querySelector('.cad-open').addEventListener('click', () => open(box));
});
