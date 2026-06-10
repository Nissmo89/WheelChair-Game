import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
// Removed OrbitControls import
import RAPIER from '@dimforge/rapier3d-compat';

// Physics Configuration
const gravity = { x: 0.0, y: -9.81, z: 0.0 };
let world;

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
document.getElementById('app').appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
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
scene.add(directionalLight);

// Custom Camera Controls
let cameraAngleAzimuth = 0; // Horizontal angle from behind
let cameraAnglePolar = Math.PI / 6; // Vertical angle (30 degrees down)
const cameraRadius = 5;

let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

renderer.domElement.addEventListener('mousedown', (e) => {
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mousemove', (e) => {
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
    isDragging = false;
});

// Loaders
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

// Physics Objects mapping
const rigidBodies = [];

// Wheelchair State
let wheelchairBody = null;
const wheelchairState = {
    frontWheels: [],
    rearWheels: []
};
const inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false
};

const maxSpeed = 20;
const accelerationForce = 50;
const turnSpeed = 2;

function initPhysics() {
    world = new RAPIER.World(gravity);

    // Create a flat ground plane for initial testing before track is ready
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100.0, 5.0, 100.0);
    groundColliderDesc.setTranslation(0, -5.0, 0); // Top surface at y=0
    world.createCollider(groundColliderDesc);
}

function loadModels() {
    // 1. Load Track
    gltfLoader.load('public/drift_race_track_free.glb', (gltf) => {
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
                        v.set(vertices[i], vertices[i+1], vertices[i+2]);
                        v.applyMatrix4(child.matrixWorld);
                        worldVertices[i] = v.x;
                        worldVertices[i+1] = v.y;
                        worldVertices[i+2] = v.z;
                    }
                    
                    let colliderDesc;
                    if (indices) {
                        colliderDesc = RAPIER.ColliderDesc.trimesh(worldVertices, indices);
                    } else {
                        // If geometry is unindexed, we must create a sequence of indices
                        const genIndices = new Uint32Array(worldVertices.length / 3);
                        for(let i=0; i<genIndices.length; i++) genIndices[i] = i;
                        colliderDesc = RAPIER.ColliderDesc.trimesh(worldVertices, genIndices);
                    }
                    
                    world.createCollider(colliderDesc);
                }
            }
        });
        scene.add(trackMesh);
        console.log("Track loaded with trimesh physics colliders!");
    });
    
    gltfLoader.load(
        'public/wheel_chair.glb',
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
            wheelchairMesh.position.y = -0.5; 
            
            wheelchairGroup.add(wheelchairMesh);
            
            scene.add(wheelchairGroup);

            // Create Physics for Wheelchair
            // We use a simple dynamic rigid body
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(0, 2, 0)
                .setLinearDamping(0.5)
                .setAngularDamping(2.0)
                .enabledRotations(false, true, false); // ONLY allow Y-axis rotation (steering), absolutely prevents flipping!
            
            wheelchairBody = world.createRigidBody(bodyDesc);
            
            // Make the collider roughly the size of a wheelchair (half-extents)
            // 0.3m wide, 0.5m high, 0.4m long = total size of 0.6m x 1.0m x 0.8m
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.3, 0.5, 0.4);
            
            // Add bounce (restitution) and reduce friction so it slides off walls instead of catching
            colliderDesc.setRestitution(0.5); 
            colliderDesc.setFriction(0.1);
            colliderDesc.setMass(50.0); // heavier wheelchair
            world.createCollider(colliderDesc, wheelchairBody);

            rigidBodies.push({
                mesh: wheelchairGroup,
                body: wheelchairBody
            });

            console.log("Wheelchair loaded and physics created");
            
            // 3. Load Character
            fbxLoader.load('public/character/source/Wolf3D_readyplayerme_male_01.fbx', (fbx) => {
                const character = fbx;
                character.scale.set(0.01, 0.01, 0.01);
                character.position.set(0, 0, -5); 
                
                const textureLoader = new THREE.TextureLoader();
                const diffuseTexture = textureLoader.load('public/character/textures/Wolf3D_Avatar_DIFFUSE.jpeg');
                diffuseTexture.colorSpace = THREE.SRGBColorSpace;
                
                character.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        child.material = new THREE.MeshStandardMaterial({
                            map: diffuseTexture,
                            roughness: 0.8,
                            skinning: true // Crucial for rigged FBX characters!
                        });
                    }
                });
                scene.add(character);
                console.log("Character loaded and added to scene directly");
            });
        },
        undefined,
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
        case 'Space': inputState.jump = true; break;
    }
});

window.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': inputState.forward = false; break;
        case 'KeyS': inputState.backward = false; break;
        case 'KeyA': inputState.left = false; break;
        case 'KeyD': inputState.right = false; break;
        case 'Space': inputState.jump = false; break;
    }
});

function handleWheelchairMovement() {
    if (!wheelchairBody) return;

    // Very basic tank/car controls applied to the rigid body
    const rotation = wheelchairBody.rotation();
    // Create a Three.js Quaternion from Rapier's
    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    
    // Forward vector is usually (0, 0, 1) or (0, 0, -1) depending on model. Assuming -Z is forward.
    const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    
    // Apply forces
    if (inputState.forward) {
        wheelchairBody.applyImpulse({ x: forwardVector.x * accelerationForce, y: 0, z: forwardVector.z * accelerationForce }, true);
    }
    if (inputState.backward) {
        wheelchairBody.applyImpulse({ x: -forwardVector.x * accelerationForce * 0.5, y: 0, z: -forwardVector.z * accelerationForce * 0.5 }, true);
    }
    
    // Realistic steering: turn rate is proportional to forward speed
    const linVel = wheelchairBody.linvel();
    // Calculate how fast the vehicle is moving in its forward direction
    const forwardSpeed = linVel.x * forwardVector.x + linVel.z * forwardVector.z;
    
    // Scale the turn speed based on how fast we're moving.
    // Divisor controls the turning radius (smaller divisor = tighter turns).
    const currentTurnSpeed = turnSpeed * (forwardSpeed / 5.0);
    
    const angVel = wheelchairBody.angvel();
    if (inputState.left) {
         wheelchairBody.setAngvel({ x: angVel.x, y: currentTurnSpeed, z: angVel.z }, true);
    } else if (inputState.right) {
         wheelchairBody.setAngvel({ x: angVel.x, y: -currentTurnSpeed, z: angVel.z }, true);
    } else {
         // Apply strong damping to Y rotation when not actively turning
         wheelchairBody.setAngvel({ x: angVel.x, y: angVel.y * 0.8, z: angVel.z }, true);
    }

    // Update UI Speed
    // linVel is already declared above
    const speed = Math.sqrt(linVel.x * linVel.x + linVel.z * linVel.z);
    // Rough conversion to km/h for display
    document.getElementById('speedDisplay').innerText = (speed * 3.6).toFixed(1);
    
    // Camera follow (attached to back, with mouse orbit)
    const position = wheelchairBody.translation();
    const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    
    // Total yaw is vehicle yaw + user drag offset
    const totalYaw = euler.y + cameraAngleAzimuth;
    
    // Spherical to Cartesian relative to vehicle
    const h = Math.cos(cameraAnglePolar) * cameraRadius;
    const offsetX = Math.sin(totalYaw) * h;
    const offsetY = Math.sin(cameraAnglePolar) * cameraRadius;
    const offsetZ = Math.cos(totalYaw) * h;
    
    camera.position.set(position.x + offsetX, position.y + offsetY + 1, position.z + offsetZ);
    camera.lookAt(position.x, position.y + 1, position.z);
    
    // Animate wheels
    // Because the mesh was rotated 90 degrees inside the group, its local X/Z axes are swapped relative to forward.
    // We assume the axle is on the local Z axis based on this sideways rotation.
    const wheelSpinSpeed = forwardSpeed * -0.15; // Negative to roll forward
    
    wheelchairState.rearWheels.forEach(w => {
        w.rotation.z += wheelSpinSpeed;
    });
    
    let targetSteer = 0;
    if (inputState.left) targetSteer = Math.PI / 6; // Steer left 30 degrees
    if (inputState.right) targetSteer = -Math.PI / 6; // Steer right 30 degrees
    
    wheelchairState.frontWheels.forEach(w => {
        w.rotation.z += wheelSpinSpeed;
        w.rotation.y += (targetSteer - w.rotation.y) * 0.15; // Smooth steering
    });
}


function updatePhysics() {
    if (!world) return;
    world.step();

    rigidBodies.forEach((rb) => {
        const position = rb.body.translation();
        const rotation = rb.body.rotation();

        rb.mesh.position.set(position.x, position.y, position.z);
        rb.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    });
}

function animate() {
    requestAnimationFrame(animate);

    handleWheelchairMovement();
    updatePhysics();

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start
RAPIER.init().then(() => {
    initPhysics();
    loadModels();
    animate();
});

