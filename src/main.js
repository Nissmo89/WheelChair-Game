import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';

// Physics Configuration
const gravity = { x: 0.0, y: -9.81, z: 0.0 };
let world;
const fixedTimeStep = 1 / 60;
const maxFrameTime = 1 / 20;
let physicsAccumulator = 0;
const clock = new THREE.Clock();

// Three.js Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
scene.fog = new THREE.Fog(0x87CEEB, 10, 200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, -5); // Set initial camera position slightly behind and above
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('app').appendChild(renderer.domElement);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(50, 100, 50);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -50;
directionalLight.shadow.camera.right = 50;
directionalLight.shadow.camera.top = 50;
directionalLight.shadow.camera.bottom = -50;
directionalLight.shadow.bias = -0.0001;
scene.add(directionalLight);

// Custom Camera Controls
let cameraAngleAzimuth = 0; // Horizontal angle from behind
let cameraAnglePolar = Math.PI / 6; // Vertical angle (30 degrees down)
const cameraRadius = 5;

// Mobile Device Detection and Controls
function detectMobile() {
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const hasHover = window.matchMedia('(hover: hover)').matches;
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    return isMobileUA || (isTouch && !hasHover) || (isTouch && hasCoarsePointer && window.innerWidth <= 1024);
}

// Helper to resolve asset path dynamically
function getAssetPath(url) {
    // If running raw in the browser (no Vite/bundler), assets are in the public/ folder.
    // If running under Vite (dev or build), assets are served at the root.
    const isRawBrowser = typeof import.meta.env === 'undefined';
    
    if (isRawBrowser) {
        // Ensure it starts with public/
        if (!url.startsWith('public/')) {
            const cleanUrl = url.replace(/^\.\//, '');
            return 'public/' + cleanUrl;
        }
        return url;
    } else {
        // Under Vite, strip 'public/' prefix because Vite serves public/ contents at root
        if (url.startsWith('public/')) {
            return './' + url.substring(7);
        }
        return url;
    }
}

function setupMobileControls() {
    const mobileControls = document.getElementById('mobile-controls');
    const controlsHelp = document.getElementById('controls-help');
    const uiElement = document.getElementById('ui');
    
    if (detectMobile()) {
        if (mobileControls) mobileControls.style.display = 'block';
        if (controlsHelp) controlsHelp.style.display = 'none';
        if (uiElement && window.innerWidth <= 1024) {
            uiElement.style.fontSize = '1.2rem';
            uiElement.style.top = '10px';
            uiElement.style.left = '10px';
        }
    } else {
        if (mobileControls) mobileControls.style.display = 'none';
        if (controlsHelp) controlsHelp.style.display = 'block';
    }
}

// Mobile touch input states
let joystickTouchId = null;
let joystickStartPos = { x: 0, y: 0 };
let cameraTouchId = null;
let previousTouchPosition = { x: 0, y: 0 };

const defaultJoystickPos = {
    left: 80,
    bottom: 80
};

let joystickBase = null;
let joystickNub = null;
let mobileJumpBtn = null;

function initMobileEventListeners() {
    joystickBase = document.getElementById('joystick-base');
    joystickNub = document.getElementById('joystick-nub');
    mobileJumpBtn = document.getElementById('mobile-jump-btn');
    
    if (!joystickBase || !joystickNub || !mobileJumpBtn) return;
    
    // Set default positions for small screens media query check
    const checkLandscape = window.matchMedia('(max-height: 500px)');
    function updateDefaultPos() {
        if (checkLandscape.matches) {
            defaultJoystickPos.left = 40;
            defaultJoystickPos.bottom = 40;
        } else {
            defaultJoystickPos.left = 80;
            defaultJoystickPos.bottom = 80;
        }
    }
    updateDefaultPos();
    window.addEventListener('resize', updateDefaultPos);

    // Jump button touch events
    mobileJumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputState.jump = true;
    }, { passive: false });

    mobileJumpBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputState.jump = false;
    }, { passive: false });

    mobileJumpBtn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputState.jump = false;
    }, { passive: false });

    // Touch handlers on window for joystick and camera swipe
    window.addEventListener('touchstart', (e) => {
        if (!detectMobile()) return;
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            // Ignore touches on jump button
            if (touch.target.closest('#mobile-jump-btn')) {
                continue;
            }
            
            // Left half: snap joystick and drag
            if (touch.clientX < window.innerWidth / 2) {
                if (joystickTouchId === null) {
                    joystickTouchId = touch.identifier;
                    joystickStartPos = { x: touch.clientX, y: touch.clientY };
                    
                    const baseRadius = 64; // width/2 of joystick base (128px)
                    joystickBase.style.left = (touch.clientX - baseRadius) + 'px';
                    joystickBase.style.top = (touch.clientY - baseRadius) + 'px';
                    joystickBase.style.bottom = 'auto';
                    joystickBase.style.opacity = '1';
                    joystickNub.style.transform = 'translate(0px, 0px)';
                }
            } else {
                // Right half: camera orbit rotation
                if (cameraTouchId === null) {
                    cameraTouchId = touch.identifier;
                    previousTouchPosition = { x: touch.clientX, y: touch.clientY };
                }
            }
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (!detectMobile()) return;
        
        // Prevent default gesture behaviours when actively playing
        if (e.target.closest('#mobile-controls') || joystickTouchId !== null || cameraTouchId !== null) {
            if (e.cancelable) {
                e.preventDefault();
            }
        }

        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            
            if (touch.identifier === joystickTouchId) {
                const dx = touch.clientX - joystickStartPos.x;
                const dy = touch.clientY - joystickStartPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxRange = 50;
                
                let targetX = dx;
                let targetY = dy;
                if (dist > maxRange) {
                    targetX = (dx / dist) * maxRange;
                    targetY = (dy / dist) * maxRange;
                }
                
                joystickNub.style.transform = `translate(${targetX}px, ${targetY}px)`;
                
                // Map to inputs: y-axis screen coordinates are inverted relative to WebGL
                const nx = targetX / maxRange;
                const ny = targetY / maxRange;
                
                inputState.forward = ny < -0.15;
                inputState.backward = ny > 0.15;
                inputState.left = nx < -0.15;
                inputState.right = nx > 0.15;
            }
            
            if (touch.identifier === cameraTouchId) {
                const deltaX = touch.clientX - previousTouchPosition.x;
                const deltaY = touch.clientY - previousTouchPosition.y;
                
                cameraAngleAzimuth -= deltaX * 0.008;
                cameraAnglePolar += deltaY * 0.008;
                cameraAnglePolar = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cameraAnglePolar));
                
                previousTouchPosition = { x: touch.clientX, y: touch.clientY };
            }
        }
    }, { passive: false });

    const handleTouchEnd = (e) => {
        if (!detectMobile()) return;
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            if (touch.identifier === joystickTouchId) {
                joystickTouchId = null;
                inputState.forward = false;
                inputState.backward = false;
                inputState.left = false;
                inputState.right = false;
                
                // Animate/return base to default layout positions
                joystickBase.style.left = defaultJoystickPos.left + 'px';
                joystickBase.style.bottom = defaultJoystickPos.bottom + 'px';
                joystickBase.style.top = 'auto';
                joystickBase.style.opacity = '0.8';
                joystickNub.style.transform = 'translate(0px, 0px)';
            }
            
            if (touch.identifier === cameraTouchId) {
                cameraTouchId = null;
            }
        }
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
}

let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

renderer.domElement.addEventListener('mousedown', (e) => {
    if (detectMobile()) return;
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mousemove', (e) => {
    if (detectMobile()) return;
    if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        cameraAngleAzimuth -= deltaX * 0.01;
        cameraAnglePolar += deltaY * 0.01;

        // Clamp polar angle to avoid flipping over or going under ground
        cameraAnglePolar = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cameraAnglePolar));

        previousMousePosition = { x: e.clientX, y: e.clientY };
    }
});

window.addEventListener('mouseup', () => {
    if (detectMobile()) return;
    isDragging = false;
});

// Loaders
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

// Physics Objects mapping
const rigidBodies = [];

// Wheelchair State
let wheelchairBody = null;
let vehicleController = null;
const wheelchairState = {
    frontWheels: [],
    rearWheels: [],
    steeringAngle: 0,
    frontWheelSpin: 0,
    rearWheelSpin: 0
};
const inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false
};

const vehicleConfig = {
    maxSpeed: 18,
    maxReverseSpeed: 5,
    engineForce: 2400,
    reverseForce: 900,
    brakeForce: 180,
    rollingBrake: 10,
    maxSteerAngle: Math.PI / 6,
    frontWheelRadius: 0.18,
    rearWheelRadius: 0.24,
    frontSuspensionRestLength: 0.07,
    rearSuspensionRestLength: 0.08,
    suspensionStiffness: 28,
    suspensionCompression: 8,
    suspensionRelaxation: 10,
    maxSuspensionForce: 12000,
    frictionSlip: 4.4,
    sideFrictionStiffness: 4.2
};

const vehicleWheelIndices = {
    frontLeft: 0,
    frontRight: 1,
    rearLeft: 2,
    rearRight: 3,
    front: [0, 1],
    rear: [2, 3],
    all: [0, 1, 2, 3]
};

const vehicleWheelSetup = [
    {
        key: 'frontLeft',
        x: -0.63,
        y: -0.25,
        z: -1.24,
        radius: vehicleConfig.frontWheelRadius,
        suspensionRestLength: vehicleConfig.frontSuspensionRestLength,
        maxSuspensionTravel: 0.12
    },
    {
        key: 'frontRight',
        x: 0.63,
        y: -0.25,
        z: -1.24,
        radius: vehicleConfig.frontWheelRadius,
        suspensionRestLength: vehicleConfig.frontSuspensionRestLength,
        maxSuspensionTravel: 0.12
    },
    {
        key: 'rearLeft',
        x: -0.8,
        y: -0.18,
        z: -0.02,
        radius: vehicleConfig.rearWheelRadius,
        suspensionRestLength: vehicleConfig.rearSuspensionRestLength,
        maxSuspensionTravel: 0.14
    },
    {
        key: 'rearRight',
        x: 0.8,
        y: -0.18,
        z: -0.02,
        radius: vehicleConfig.rearWheelRadius,
        suspensionRestLength: vehicleConfig.rearSuspensionRestLength,
        maxSuspensionTravel: 0.14
    }
];

const wheelchairModelConfig = {
    spawnPosition: { x: 0, y: 1.35, z: -6 },
    visualOffsetY: -0.5
};

let collisionDebugEnabled = false;
let collisionDebugMesh = null;
let wheelRayDebugMesh = null;
let wheelchairRigidBodyState = null;
let fallbackGroundCollider = null;
let wheelchairVisualGroup = null;

// Loading screen state
let loadingState = {
    physicsLoaded: false,
    trackProgress: 0,
    wheelchairProgress: 0,
    characterProgress: 0
};

function updateLoadingProgress() {
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    const loadingScreen = document.getElementById('loading-screen');
    
    if (!loadingText || !progressBar) return;
    
    // Physics counts as 10% of total progress, assets count as 90%
    let assetProgress = (loadingState.trackProgress + loadingState.wheelchairProgress + loadingState.characterProgress) / 3;
    let totalProgress = 0;
    
    if (loadingState.physicsLoaded) {
        totalProgress = 10 + (assetProgress * 0.9);
    } else {
        totalProgress = 5;
    }
    
    totalProgress = Math.min(100, Math.round(totalProgress));
    
    progressBar.style.width = totalProgress + '%';
    
    if (totalProgress < 10) {
        loadingText.innerText = 'Initializing physics engine...';
    } else if (totalProgress < 95) {
        loadingText.innerText = `Downloading game assets... ${totalProgress}%`;
    } else {
        loadingText.innerText = 'Ready!';
    }
    
    if (totalProgress >= 100) {
        setTimeout(() => {
            if (loadingScreen) {
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                }, 500);
            }
        }, 300);
    }
}

const interpolatedWheelchairPosition = new THREE.Vector3();
const interpolatedWheelchairQuaternion = new THREE.Quaternion();
const smoothedWheelchairPosition = new THREE.Vector3();
const smoothedWheelchairQuaternion = new THREE.Quaternion();
const desiredCameraPosition = new THREE.Vector3();
const desiredCameraTarget = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
let smoothedCameraHeight = 0;
let cameraInitialized = false;
let wheelchairVisualInitialized = false;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function createDebugLineMesh(opacity = 0.95) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    scene.add(mesh);
    return mesh;
}

function setDebugGeometry(mesh, positions, colors) {
    const geometry = mesh.geometry;
    const positionArray = positions instanceof Float32Array ? positions : new Float32Array(positions);
    const colorArray = colors instanceof Float32Array ? colors : new Float32Array(colors);

    const positionAttribute = geometry.getAttribute('position');
    if (!positionAttribute || positionAttribute.array.length !== positionArray.length) {
        geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
    } else {
        positionAttribute.array.set(positionArray);
        positionAttribute.needsUpdate = true;
    }

    const colorAttribute = geometry.getAttribute('color');
    if (!colorAttribute || colorAttribute.array.length !== colorArray.length) {
        geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    } else {
        colorAttribute.array.set(colorArray);
        colorAttribute.needsUpdate = true;
    }

    geometry.setDrawRange(0, positionArray.length / 3);
    if (positionArray.length > 0) {
        geometry.computeBoundingSphere();
    }
}

function createCollisionDebug() {
    collisionDebugMesh = createDebugLineMesh(0.9);
    wheelRayDebugMesh = createDebugLineMesh(0.95);
}

function createRigidBodyBinding(mesh, body) {
    const binding = {
        mesh,
        body,
        previousPosition: new THREE.Vector3(),
        currentPosition: new THREE.Vector3(),
        previousQuaternion: new THREE.Quaternion(),
        currentQuaternion: new THREE.Quaternion()
    };
    updateRigidBodyBinding(binding);
    binding.previousPosition.copy(binding.currentPosition);
    binding.previousQuaternion.copy(binding.currentQuaternion);
    return binding;
}

function updateRigidBodyBinding(binding) {
    binding.previousPosition.copy(binding.currentPosition);
    binding.previousQuaternion.copy(binding.currentQuaternion);

    const position = binding.body.translation();
    const rotation = binding.body.rotation();
    binding.currentPosition.set(position.x, position.y, position.z);
    binding.currentQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

function sampleRigidBodyBinding(binding, alpha, targetPosition, targetQuaternion) {
    targetPosition.lerpVectors(binding.previousPosition, binding.currentPosition, alpha);
    targetQuaternion.copy(binding.previousQuaternion).slerp(binding.currentQuaternion, alpha);
}

function updateCollisionDebug() {
    if (!collisionDebugMesh || !wheelRayDebugMesh) return;

    collisionDebugMesh.visible = collisionDebugEnabled;
    wheelRayDebugMesh.visible = collisionDebugEnabled;
    if (!collisionDebugEnabled || !world) return;

    const debugBuffers = world.debugRender();
    const colorBuffer = new Float32Array((debugBuffers.colors.length / 4) * 3);
    for (let source = 0, target = 0; source < debugBuffers.colors.length; source += 4, target += 3) {
        colorBuffer[target] = debugBuffers.colors[source];
        colorBuffer[target + 1] = debugBuffers.colors[source + 1];
        colorBuffer[target + 2] = debugBuffers.colors[source + 2];
    }
    setDebugGeometry(collisionDebugMesh, debugBuffers.vertices, colorBuffer);
    updateWheelRayDebug();
}

function updateWheelRayDebug() {
    if (!wheelRayDebugMesh) return;
    if (!vehicleController) {
        setDebugGeometry(wheelRayDebugMesh, [], []);
        return;
    }

    const positions = [];
    const colors = [];
    const wheelCount = vehicleController.numWheels();
    for (let i = 0; i < wheelCount; i++) {
        const hardPoint = vehicleController.wheelHardPoint(i);
        if (!hardPoint) continue;

        const isGrounded = vehicleController.wheelIsInContact(i);
        const contactPoint = isGrounded ? vehicleController.wheelContactPoint(i) : null;
        const wheelSetup = vehicleWheelSetup[i];
        const castLength = (vehicleController.wheelSuspensionRestLength(i) ?? wheelSetup?.suspensionRestLength ?? vehicleConfig.rearSuspensionRestLength)
            + (vehicleController.wheelRadius(i) ?? wheelSetup?.radius ?? vehicleConfig.rearWheelRadius);
        const endPoint = contactPoint ?? {
            x: hardPoint.x,
            y: hardPoint.y - castLength,
            z: hardPoint.z
        };

        positions.push(hardPoint.x, hardPoint.y, hardPoint.z, endPoint.x, endPoint.y, endPoint.z);

        const color = isGrounded ? [0.15, 1.0, 0.25] : [1.0, 0.25, 0.1];
        colors.push(...color, ...color);
    }

    setDebugGeometry(wheelRayDebugMesh, positions, colors);
}

window.__wheelchairDebug = () => {
    if (!wheelchairBody) {
        return { loaded: false, collisionDebugEnabled };
    }

    const { forward, right } = getWheelchairBasis();
    const linVel = wheelchairBody.linvel();
    const wheels = [];
    if (vehicleController) {
        for (let i = 0; i < vehicleController.numWheels(); i++) {
            wheels.push({
                index: i,
                grounded: vehicleController.wheelIsInContact(i),
                suspensionLength: vehicleController.wheelSuspensionLength(i),
                hardPoint: vehicleController.wheelHardPoint(i),
                contactPoint: vehicleController.wheelContactPoint(i),
                engineForce: vehicleController.wheelEngineForce(i),
                brake: vehicleController.wheelBrake(i)
            });
        }
    }

    return {
        loaded: true,
        collisionDebugEnabled,
        position: wheelchairBody.translation(),
        velocity: linVel,
        forwardSpeed: linVel.x * forward.x + linVel.z * forward.z,
        lateralSpeed: linVel.x * right.x + linVel.z * right.z,
        wheels
    };
};

function initPhysics() {
    world = new RAPIER.World(gravity);
    world.timestep = fixedTimeStep;
    world.integrationParameters.numSolverIterations = 8;
    world.integrationParameters.maxCcdSubsteps = 4;

    // Create a flat ground plane for initial testing before track is ready
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100.0, 5.0, 100.0);
    groundColliderDesc.setTranslation(0, -5.0, 0); // Top surface at y=0
    groundColliderDesc.setFriction(1.2);
    fallbackGroundCollider = world.createCollider(groundColliderDesc);

    createCollisionDebug();
    loadingState.physicsLoaded = true;
    updateLoadingProgress();
}

function configureVehicleWheel(controller, index, wheelSetup) {
    controller.setWheelSuspensionRestLength(index, wheelSetup.suspensionRestLength);
    controller.setWheelRadius(index, wheelSetup.radius);
    controller.setWheelSuspensionStiffness(index, vehicleConfig.suspensionStiffness);
    controller.setWheelSuspensionCompression(index, vehicleConfig.suspensionCompression);
    controller.setWheelSuspensionRelaxation(index, vehicleConfig.suspensionRelaxation);
    controller.setWheelMaxSuspensionForce(index, vehicleConfig.maxSuspensionForce);
    controller.setWheelMaxSuspensionTravel(index, wheelSetup.maxSuspensionTravel);
    controller.setWheelFrictionSlip(index, vehicleConfig.frictionSlip);
    controller.setWheelSideFrictionStiffness(index, vehicleConfig.sideFrictionStiffness);
}

function createWheelchairVehicleController() {
    const controller = new RAPIER.DynamicRayCastVehicleController(
        wheelchairBody,
        world.broadPhase,
        world.narrowPhase,
        world.bodies,
        world.colliders
    );

    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;

    vehicleWheelSetup.forEach((wheel, index) => {
        controller.addWheel(
            { x: wheel.x, y: wheel.y, z: wheel.z },
            { x: 0, y: -1, z: 0 },
            { x: -1, y: 0, z: 0 },
            wheel.suspensionRestLength,
            wheel.radius
        );
        configureVehicleWheel(controller, index, wheel);
    });

    return controller;
}

function createWheelchairColliders(body) {
    const colliderConfigs = [
        {
            type: 'roundCuboid',
            halfExtents: [0.65, 0.25, 0.65],
            borderRadius: 0.1,
            translation: [0, 0.2, -0.6],
            friction: 0.12
        },
        {
            type: 'roundCuboid',
            halfExtents: [0.35, 0.4, 0.16],
            borderRadius: 0.05,
            translation: [0, 0.8, 0.0],
            friction: 0.2
        }
    ];

    colliderConfigs.forEach(({ type, halfExtents, halfHeight, radius, borderRadius, translation, rotation, friction }) => {
        let colliderDesc;
        if (type === 'capsule') {
            colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
        } else if (type === 'roundCuboid') {
            colliderDesc = RAPIER.ColliderDesc.roundCuboid(...halfExtents, borderRadius);
        } else {
            colliderDesc = RAPIER.ColliderDesc.cuboid(...halfExtents);
        }

        colliderDesc.setTranslation(...translation);
        if (rotation) {
            const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
            colliderDesc.setRotation(orientation);
        }
        colliderDesc.setRestitution(0.02);
        colliderDesc.setFriction(friction ?? 0.28);
        colliderDesc.setDensity(0.0);
        world.createCollider(colliderDesc, body);
    });
}

function loadModels() {
    // 1. Load Track
    gltfLoader.load(
        getAssetPath('./drift_race_track_free.glb'), 
        (gltf) => {
            const trackMesh = gltf.scene;

            // Ensure the scene matrix is updated before generating physics
            trackMesh.updateMatrixWorld(true);

            trackMesh.traverse((child) => {
                if (child.isMesh) {
                    child.receiveShadow = true;

                    // Generate Trimesh collider for the track
                    const geometry = child.geometry;
                    const vertices = geometry.attributes.position.array;
                    const indices = geometry.index ? geometry.index.array : undefined;

                    if (vertices && vertices.length > 0) {
                        // Apply the mesh's world transform to the vertices
                        // so the physics collider matches the visual model exactly
                        const worldVertices = new Float32Array(vertices.length);
                        const v = new THREE.Vector3();
                        for (let i = 0; i < vertices.length; i += 3) {
                            v.set(vertices[i], vertices[i + 1], vertices[i + 2]);
                            v.applyMatrix4(child.matrixWorld);
                            worldVertices[i] = v.x;
                            worldVertices[i + 1] = v.y;
                            worldVertices[i + 2] = v.z;
                        }

                        let colliderDesc;
                        if (indices) {
                            colliderDesc = RAPIER.ColliderDesc.trimesh(worldVertices, indices);
                        } else {
                            // If geometry is unindexed, we must create a sequence of indices
                            const genIndices = new Uint32Array(worldVertices.length / 3);
                            for (let i = 0; i < genIndices.length; i++) genIndices[i] = i;
                            colliderDesc = RAPIER.ColliderDesc.trimesh(worldVertices, genIndices);
                        }

                        colliderDesc.setFriction(1.2);
                        world.createCollider(colliderDesc);
                    }
                }
            });
            scene.add(trackMesh);
            if (fallbackGroundCollider) {
                world.removeCollider(fallbackGroundCollider, false);
                fallbackGroundCollider = null;
            }
            console.log("Track loaded with trimesh physics colliders!");
            loadingState.trackProgress = 100;
            updateLoadingProgress();
        },
        (xhr) => {
            if (xhr.lengthComputable && xhr.total > 0) {
                loadingState.trackProgress = (xhr.loaded / xhr.total) * 100;
            } else {
                loadingState.trackProgress = Math.min(99, (xhr.loaded / 57555548) * 100);
            }
            updateLoadingProgress();
        },
        (error) => {
            console.error('Error loading track', error);
        }
    );

    gltfLoader.load(
        getAssetPath('./wheel_chair.glb'),
        (gltf) => {
            const wheelchairMesh = gltf.scene;
            const allWheels = [];

            wheelchairMesh.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    // Basic heuristic to identify wheels by their geometry bounding box
                    child.geometry.computeBoundingBox();
                    const size = new THREE.Vector3();
                    child.geometry.boundingBox.getSize(size);

                    const dims = [
                        { axis: 'x', val: size.x },
                        { axis: 'y', val: size.y },
                        { axis: 'z', val: size.z }
                    ].sort((a, b) => a.val - b.val);

                    // A wheel is a disk: one small dimension (axle), two large dimensions (roughly equal)
                    const isWheel = (dims[0].val < dims[2].val * 0.5) && (dims[2].val - dims[1].val < dims[2].val * 0.3);

                    if (isWheel) {
                        const center = new THREE.Vector3();
                        child.geometry.boundingBox.getCenter(center);
                        // Center geometry so rotation happens locally around its own center
                        child.geometry.translate(-center.x, -center.y, -center.z);
                        child.position.x += center.x;
                        child.position.y += center.y;
                        child.position.z += center.z;

                        allWheels.push({ mesh: child, size: dims[2].val, axle: dims[0].axis });
                    }
                }
            });

            // Sort wheels by size. Rear wheels are typically larger in wheelchairs.
            allWheels.sort((a, b) => b.size - a.size);
            if (allWheels.length >= 4) {
                wheelchairState.rearWheels = [allWheels[0].mesh, allWheels[1].mesh];
                wheelchairState.frontWheels = [allWheels[2].mesh, allWheels[3].mesh];
            } else {
                wheelchairState.rearWheels = allWheels.map(w => w.mesh);
            }

            // Adjust scale if needed
            wheelchairMesh.scale.set(0.1, 0.1, 0.1);

            // Fix sideways orientation by placing in a group and rotating
            const wheelchairGroup = new THREE.Group();
            wheelchairMesh.rotation.y = Math.PI / 2; // Adjust to Math.PI/2 if facing backwards

            // Settle it on the surface: Offset visual downwards to match collider's physical bottom
            wheelchairMesh.position.y = wheelchairModelConfig.visualOffsetY;

            wheelchairGroup.add(wheelchairMesh);

            scene.add(wheelchairGroup);

            // Create a dynamic chassis. Roll and pitch stay locked so the chair
            // remains drivable while the raycast wheels provide suspension and grip.
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(
                    wheelchairModelConfig.spawnPosition.x,
                    wheelchairModelConfig.spawnPosition.y,
                    wheelchairModelConfig.spawnPosition.z
                )
                .setAdditionalMassProperties(
                    75,
                    { x: 0, y: -0.18, z: -0.02 },
                    { x: 10, y: 7, z: 11 },
                    { x: 0, y: 0, z: 0, w: 1 }
                )
                .setLinearDamping(0.28)
                .setAngularDamping(3.4)
                .setCcdEnabled(true)
                .setCanSleep(true)
                .enabledRotations(false, true, false);

            wheelchairBody = world.createRigidBody(bodyDesc);
            createWheelchairColliders(wheelchairBody);
            vehicleController = createWheelchairVehicleController();
            wheelchairVisualGroup = wheelchairGroup;

            wheelchairRigidBodyState = createRigidBodyBinding(wheelchairGroup, wheelchairBody);
            wheelchairGroup.position.copy(wheelchairRigidBodyState.currentPosition);
            wheelchairGroup.quaternion.copy(wheelchairRigidBodyState.currentQuaternion);
            rigidBodies.push(wheelchairRigidBodyState);

            console.log("Wheelchair loaded and physics created");
            loadingState.wheelchairProgress = 100;
            updateLoadingProgress();

            // 3. Load Character
            fbxLoader.load(
                getAssetPath('./character/source/Wolf3D_readyplayerme_male_01.fbx'), 
                (fbx) => {
                    const character = fbx;
                    character.scale.set(0.01, 0.01, 0.01);
                    character.position.set(0, 0, -5);

                    const textureLoader = new THREE.TextureLoader();
                    const diffuseTexture = textureLoader.load(getAssetPath('./character/textures/Wolf3D_Avatar_DIFFUSE.jpeg'));
                    diffuseTexture.colorSpace = THREE.SRGBColorSpace;

                    character.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            child.material = new THREE.MeshStandardMaterial({
                                map: diffuseTexture,
                                transparent: false,
                                roughness: 0.8
                            });
                        }
                    });
                    scene.add(character);
                    console.log("Character loaded and added to scene directly");
                    loadingState.characterProgress = 100;
                    updateLoadingProgress();
                },
                (xhr) => {
                    if (xhr.lengthComputable && xhr.total > 0) {
                        loadingState.characterProgress = (xhr.loaded / xhr.total) * 100;
                    } else {
                        loadingState.characterProgress = Math.min(99, (xhr.loaded / 2000000) * 100);
                    }
                    updateLoadingProgress();
                },
                (error) => {
                    console.error('Error loading character', error);
                }
            );
        },
        (xhr) => {
            if (xhr.lengthComputable && xhr.total > 0) {
                loadingState.wheelchairProgress = (xhr.loaded / xhr.total) * 100;
            } else {
                loadingState.wheelchairProgress = Math.min(99, (xhr.loaded / 36703812) * 100);
            }
            updateLoadingProgress();
        },
        (error) => {
            console.error('An error happened loading the wheelchair', error);
        }
    );
}

// Input Handling
window.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'KeyW': inputState.forward = true; break;
        case 'KeyS': inputState.backward = true; break;
        case 'KeyA': inputState.left = true; break;
        case 'KeyD': inputState.right = true; break;
        case 'Space':
            e.preventDefault();
            inputState.jump = true;
            break;
        case 'F1':
            e.preventDefault();
            collisionDebugEnabled = !collisionDebugEnabled;
            break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': inputState.forward = false; break;
        case 'KeyS': inputState.backward = false; break;
        case 'KeyA': inputState.left = false; break;
        case 'KeyD': inputState.right = false; break;
        case 'Space':
            e.preventDefault();
            inputState.jump = false;
            break;
    }
});

function getWheelchairBasis() {
    const rotation = wheelchairBody.rotation();
    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    return {
        q,
        forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    };
}

function applyWheelchairVehicleControls(dt) {
    if (!wheelchairBody) return;

    const { forward, right } = getWheelchairBasis();
    const linVel = wheelchairBody.linvel();
    const forwardSpeed = linVel.x * forward.x + linVel.z * forward.z;
    const lateralSpeed = linVel.x * right.x + linVel.z * right.z;
    const accelerating = inputState.forward && !inputState.backward;
    const brakingOrReversing = inputState.backward && !inputState.forward;

    const steerInput = (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0);
    const hasDriveInput = accelerating || brakingOrReversing || steerInput !== 0;
    if (hasDriveInput) {
        wheelchairBody.wakeUp();
    }
    const steeringBySpeed = clamp(1 - Math.abs(forwardSpeed) / (vehicleConfig.maxSpeed * 1.35), 0.38, 1);
    const targetSteering = steerInput * vehicleConfig.maxSteerAngle * steeringBySpeed;
    wheelchairState.steeringAngle += (targetSteering - wheelchairState.steeringAngle) * clamp(dt * 12, 0, 1);

    if (accelerating && forwardSpeed < vehicleConfig.maxSpeed) {
        wheelchairBody.applyImpulse({
            x: forward.x * vehicleConfig.engineForce * dt,
            y: 0,
            z: forward.z * vehicleConfig.engineForce * dt
        }, true);
    } else if (brakingOrReversing) {
        if (forwardSpeed > 0.5) {
            wheelchairBody.applyImpulse({
                x: -forward.x * vehicleConfig.brakeForce * dt * 8,
                y: 0,
                z: -forward.z * vehicleConfig.brakeForce * dt * 8
            }, true);
        } else if (forwardSpeed > -vehicleConfig.maxReverseSpeed) {
            wheelchairBody.applyImpulse({
                x: -forward.x * vehicleConfig.reverseForce * dt,
                y: 0,
                z: -forward.z * vehicleConfig.reverseForce * dt
            }, true);
        }
    }

    const updatedLinVel = wheelchairBody.linvel();
    let adjustedForwardSpeed = updatedLinVel.x * forward.x + updatedLinVel.z * forward.z;
    let adjustedLateralSpeed = updatedLinVel.x * right.x + updatedLinVel.z * right.z;

    const lateralGrip = clamp(1 - dt * 9, 0, 1);
    adjustedLateralSpeed *= lateralGrip;

    if (!accelerating && !brakingOrReversing) {
        adjustedForwardSpeed *= clamp(1 - dt * 8, 0, 1);
        adjustedLateralSpeed *= clamp(1 - dt * 12, 0, 1);
    } else if (brakingOrReversing && adjustedForwardSpeed > 0) {
        adjustedForwardSpeed *= clamp(1 - dt * 9, 0, 1);
    }

    adjustedForwardSpeed = clamp(adjustedForwardSpeed, -vehicleConfig.maxReverseSpeed, vehicleConfig.maxSpeed);
    if (!accelerating && !brakingOrReversing && Math.abs(adjustedForwardSpeed) < 0.45) {
        adjustedForwardSpeed = 0;
    }
    if (!accelerating && !brakingOrReversing && Math.abs(adjustedLateralSpeed) < 0.25) {
        adjustedLateralSpeed = 0;
    } else if (Math.abs(adjustedLateralSpeed) < 0.02) {
        adjustedLateralSpeed = 0;
    }

    const readyForSleep = !hasDriveInput
        && adjustedForwardSpeed === 0
        && adjustedLateralSpeed === 0
        && Math.abs(updatedLinVel.y) < 0.08;

    wheelchairBody.setLinvel({
        x: forward.x * adjustedForwardSpeed + right.x * adjustedLateralSpeed,
        y: readyForSleep ? 0 : updatedLinVel.y,
        z: forward.z * adjustedForwardSpeed + right.z * adjustedLateralSpeed
    }, true);

    const speedForTurning = Math.abs(adjustedForwardSpeed);
    const direction = adjustedForwardSpeed >= 0 ? 1 : -1;
    const targetYawRate = speedForTurning > 0.15
        ? steerInput * clamp(speedForTurning / 4.5, 0.25, 1) * 1.8 * direction
        : 0;
    const angularVelocity = wheelchairBody.angvel();
    const yawBlend = steerInput === 0 ? clamp(dt * 10, 0, 1) : clamp(dt * 14, 0, 1);
    const stabilizedYaw = angularVelocity.y + (targetYawRate - angularVelocity.y) * yawBlend;
    wheelchairBody.setAngvel({
        x: 0,
        y: readyForSleep || (Math.abs(stabilizedYaw) < 0.02 && steerInput === 0) ? 0 : stabilizedYaw,
        z: 0
    }, true);

    if (readyForSleep) {
        wheelchairBody.sleep();
    }

    wheelchairState.rearWheelSpin += -adjustedForwardSpeed * dt / vehicleConfig.rearWheelRadius;
    wheelchairState.frontWheelSpin += -adjustedForwardSpeed * dt / vehicleConfig.frontWheelRadius;
}

function updateWheelchairCameraAndVisuals(dt, interpolationAlpha) {
    if (!wheelchairBody || !wheelchairRigidBodyState) return;

    sampleRigidBodyBinding(
        wheelchairRigidBodyState,
        interpolationAlpha,
        interpolatedWheelchairPosition,
        interpolatedWheelchairQuaternion
    );

    if (wheelchairVisualGroup) {
        if (!wheelchairVisualInitialized) {
            smoothedWheelchairPosition.copy(interpolatedWheelchairPosition);
            smoothedWheelchairQuaternion.copy(interpolatedWheelchairQuaternion);
            wheelchairVisualInitialized = true;
        } else {
            const visualAlpha = 1 - Math.exp(-dt * 16);
            smoothedWheelchairPosition.lerp(interpolatedWheelchairPosition, visualAlpha);
            smoothedWheelchairQuaternion.slerp(interpolatedWheelchairQuaternion, visualAlpha);
        }

        wheelchairVisualGroup.position.copy(smoothedWheelchairPosition);
        wheelchairVisualGroup.quaternion.copy(smoothedWheelchairQuaternion);
    }

    const vehiclePosition = wheelchairVisualGroup ? wheelchairVisualGroup.position : interpolatedWheelchairPosition;
    const vehicleQuaternion = wheelchairVisualGroup ? wheelchairVisualGroup.quaternion : interpolatedWheelchairQuaternion;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(vehicleQuaternion);
    const linVel = wheelchairBody.linvel();
    const forwardSpeed = linVel.x * forward.x + linVel.z * forward.z;
    const horizontalSpeed = Math.sqrt(linVel.x * linVel.x + linVel.z * linVel.z);
    document.getElementById('speedDisplay').innerText = (horizontalSpeed * 3.6).toFixed(1);

    if (!cameraInitialized) {
        smoothedCameraHeight = vehiclePosition.y;
    } else {
        const heightAlpha = 1 - Math.exp(-dt * 5);
        smoothedCameraHeight += (vehiclePosition.y - smoothedCameraHeight) * heightAlpha;
    }

    // Camera follow (attached to back, with mouse orbit)
    const euler = new THREE.Euler().setFromQuaternion(vehicleQuaternion, 'YXZ');

    // Total yaw is vehicle yaw + user drag offset
    const totalYaw = euler.y + cameraAngleAzimuth;

    // Spherical to Cartesian relative to vehicle
    const h = Math.cos(cameraAnglePolar) * cameraRadius;
    const offsetX = Math.sin(totalYaw) * h;
    const offsetY = Math.sin(cameraAnglePolar) * cameraRadius;
    const offsetZ = Math.cos(totalYaw) * h;

    desiredCameraPosition.set(
        vehiclePosition.x + offsetX,
        smoothedCameraHeight + offsetY + 1,
        vehiclePosition.z + offsetZ
    );
    desiredCameraTarget.set(
        vehiclePosition.x,
        smoothedCameraHeight + 1,
        vehiclePosition.z
    );

    if (!cameraInitialized) {
        camera.position.copy(desiredCameraPosition);
        cameraLookTarget.copy(desiredCameraTarget);
        cameraInitialized = true;
    } else {
        const followAlpha = 1 - Math.exp(-dt * 14);
        const targetAlpha = 1 - Math.exp(-dt * 18);
        camera.position.lerp(desiredCameraPosition, followAlpha);
        cameraLookTarget.lerp(desiredCameraTarget, targetAlpha);
    }

    camera.lookAt(cameraLookTarget);

    const rearWheelRotation = vehicleController
        ? vehicleWheelIndices.rear
            .map((index) => vehicleController.wheelRotation(index))
            .filter((rotation) => rotation != null)
        : [];
    const frontWheelRotation = vehicleController
        ? vehicleWheelIndices.front
            .map((index) => vehicleController.wheelRotation(index))
            .filter((rotation) => rotation != null)
        : [];
    const rearSpin = rearWheelRotation.length > 0
        ? rearWheelRotation.reduce((sum, rotation) => sum + rotation, 0) / rearWheelRotation.length
        : wheelchairState.rearWheelSpin;
    const frontSpin = frontWheelRotation.length > 0
        ? frontWheelRotation.reduce((sum, rotation) => sum + rotation, 0) / frontWheelRotation.length
        : wheelchairState.frontWheelSpin;

    wheelchairState.rearWheels.forEach(w => {
        w.rotation.z = rearSpin;
    });

    wheelchairState.frontWheels.forEach(w => {
        w.rotation.z = frontSpin;
        w.rotation.y += (wheelchairState.steeringAngle - w.rotation.y) * clamp(dt * 10, 0, 1);
    });
}


function syncRigidBodies(interpolationAlpha) {
    rigidBodies.forEach((binding) => {
        if (binding === wheelchairRigidBodyState) return;
        sampleRigidBodyBinding(
            binding,
            interpolationAlpha,
            binding.mesh.position,
            binding.mesh.quaternion
        );
    });
}

function updatePhysics(deltaTime) {
    if (!world) return 0;

    physicsAccumulator += Math.min(deltaTime, maxFrameTime);
    while (physicsAccumulator >= fixedTimeStep) {
        applyWheelchairVehicleControls(fixedTimeStep);
        if (vehicleController) {
            vehicleController.updateVehicle(fixedTimeStep);
        }
        world.step();
        rigidBodies.forEach(updateRigidBodyBinding);
        physicsAccumulator -= fixedTimeStep;
    }

    const interpolationAlpha = clamp(physicsAccumulator / fixedTimeStep, 0, 1);
    syncRigidBodies(interpolationAlpha);
    updateCollisionDebug();
    return interpolationAlpha;
}

function animate() {
    requestAnimationFrame(animate);

    const deltaTime = Math.min(clock.getDelta(), maxFrameTime);
    const interpolationAlpha = updatePhysics(deltaTime);
    updateWheelchairCameraAndVisuals(deltaTime, interpolationAlpha);

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    setupMobileControls();
});

// Start
RAPIER.init().then(() => {
    initPhysics();
    loadModels();
    setupMobileControls();
    initMobileEventListeners();
    animate();
});
