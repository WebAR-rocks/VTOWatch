const NNPath = 'neuralNets/';

const wristModesCommonSettings = {
  threshold: 0.8, // detection sensitivity, between 0 and 1
  
  poseLandmarksLabels: [
  // wristRightBottom not working
    //"wristBack", "wristLeft", "wristRight", "wristPalm", "wristPalmTop", "wristBackTop", "wristRightBottom", "wristLeftBottom" // more accurate
    "wristBack", "wristRight", "wristPalm", "wristPalmTop", "wristBackTop", "wristLeft" // more stable
   ],
  isPoseFilter: true,

  // soft occluder parameters (soft because we apply a fading gradient)
  occluderType: "SOFTCYLINDER",
  occluderRadiusRange: [4, 4.7], // first value: minimum or interior radius of the occluder (full transparency).
                               // second value: maximum or exterior radius of the occluder (full opacity, no occluding effect)
  occluderHeight: 48, // height of the cylinder
  occluderOffset: [0,0,0], // relative to the wrist 3D model
  occluderQuaternion: [0.707,0,0,0.707], // rotation of Math.PI/2 along X axis,
  occluderFlattenCoeff: 0.6, // 1 -> occluder is a cylinder 0.5 -> flatten by 50%

  objectPointsPositionFactors: [1.0, 1.3, 1.0], // factors to apply to point positions to lower pose angles - dirty tweak

  stabilizerOptions: {
    minCutOff: 0.001,
    beta: 3,
    freqRange: [2, 144],
    forceFilterNNInputPxRange: [2.5, 6],//[1.5, 4],
  }
};

const wristModelCommonSettings = {
  URL: 'assets/watchCasio.glb',
  
  scale: 1.3 * 1.462,
  offset: [0.076, -0.916, -0.504],
  quaternion: [0,0,0,1], // Format: X,Y,Z,W (and not W,X,Y,Z like Blender)
};


const _settings = {
  VTOModes: {
    wrist: Object.assign({      
      NNsPaths: [NNPath + 'NN_WRISTBACK_21.json']
    }, wristModesCommonSettings)
  },

  models: {
    wristDemo: Object.assign({
      VTOMode: 'wrist'
    }, wristModelCommonSettings)
  },
  initialModel: 'wristDemo',

  // debug flags:
  debugDisplayLandmarks: false,
  debugMeshMaterial: false,
  debugOccluder: false
};

//_settings.debugOccluder = true;

let _VTOMode = null;
let _VTOModel = null;

const _states = {
  notLoaded: -1,
  loading: 0,
  idle: 1,
  running: 2,
  busy: 3
};
let _state = _states.notLoaded;
let _isInstructionsHidden = false;


function setFullScreen(cv){
  const pixelRatio = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  cv.width = pixelRatio * Math.min(w, h*3/4);
  cv.height = pixelRatio * h;
}


// entry point:
function main(){
  _state = _states.loading;

  // get canvases and size them:
  const handTrackerCanvas = document.getElementById('handTrackerCanvas');
  const VTOCanvas = document.getElementById('VTOCanvas');
  
  setFullScreen(handTrackerCanvas);
  setFullScreen(VTOCanvas);

  // init change VTO button:
  ChangeCameraHelper.init({
    canvases: [handTrackerCanvas, VTOCanvas],
    DOMChangeCameraButton: document.getElementById('changeCamera')
  })

  // initial VTO mode:
  const initialModelSettings = _settings.models[_settings.initialModel];
  _VTOMode = initialModelSettings.VTOMode; // "ring" or "wrist"
  const VTOModeSettings = _settings.VTOModes[_VTOMode];

  // initialize Helper:
  HandTrackerThreeHelper.init({
    stabilizerOptions: VTOModeSettings.stabilizerOptions,
    objectPointsPositionFactors: VTOModeSettings.objectPointsPositionFactors,
    poseLandmarksLabels: VTOModeSettings.poseLandmarksLabels,
    poseFilter: null,
    NNsPaths: VTOModeSettings.NNsPaths,
    threshold: VTOModeSettings.threshold,
    callbackTrack: callbackTrack,
    VTOCanvas: VTOCanvas,
    videoSettings: {
      facingMode: 'user'
    },
    handTrackerCanvas: handTrackerCanvas,
    debugDisplayLandmarks: _settings.debugDisplayLandmarks,
  }).then(start).catch(function(err){
    throw new Error(err);
  });
} 


function setup_lighting(three){
  const scene = three.scene;

  const pmremGenerator = new THREE.PMREMGenerator( three.renderer );
  pmremGenerator.compileEquirectangularShader();

  new THREE.RGBELoader().setDataType( THREE.HalfFloatType )
    .load('assets/hotel_room_1k.hdr', function ( texture ) {
    const envMap = pmremGenerator.fromEquirectangular( texture ).texture;
    pmremGenerator.dispose();
    scene.environment = envMap;
  });

  // improve WebGLRenderer settings:
  three.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  three.renderer.outputEncoding = THREE.sRGBEncoding;
}


function load_model(modelId, threeLoadingManager){
  if (   (_state !== _states.running && _state !== _states.idle)
      || modelId === _VTOModel){
    return; // model is already loaded or state is busy or loading
  }
  _state = _states.busy;
  const modelSettings = _settings.models[modelId];

  // remove previous model but not occluders:
  HandTrackerThreeHelper.clear_threeObjects(false);
  
  // load new model:
  new THREE.GLTFLoader(threeLoadingManager).load(modelSettings.URL, function(model){
    const me = model.scene.children[0]; // instance of THREE.Mesh
    me.scale.set(1, 1, 1);
    
    // tweak the material:
    if (_settings.debugMeshMaterial){
      me.traverse(function(child){
        if (child.material){
          child.material = new THREE.MeshNormalMaterial();
        }});
    }

    // tweak position, scale and rotation:
    if (modelSettings.scale){
      me.scale.multiplyScalar(modelSettings.scale);
    }
    if (modelSettings.offset){
      const d = modelSettings.offset;
      const displacement = new THREE.Vector3(d[0], d[2], -d[1]); // inverse Y and Z
      me.position.add(displacement);
    }
    if (modelSettings.quaternion){
      const q = modelSettings.quaternion;
      me.quaternion.set(q[0], q[2], -q[1], q[3]);
    }

    // add to the tracker:
    HandTrackerThreeHelper.add_threeObject(me);

    _state = _states.running;

  });
}


function start(three){
  VTOCanvas.style.zIndex = 3; // fix a weird bug on iOS15 / safari

  setup_lighting(three);

  three.loadingManager.onLoad = function(){
    console.log('INFO in main.js: All THREE.js stuffs are loaded');
    hide_loading();
    _state = _states.running;
  }

  set_occluder().then(function(){
    _state = _states.idle;
  }).then(function(){
    load_model(_settings.initialModel, three.loadingManager);
  });
}


function set_occluder(){
  const VTOModeSettings = _settings.VTOModes[_VTOMode];

  if (VTOModeSettings.occluderType === 'SOFTCYLINDER'){
    return add_softOccluder(VTOModeSettings);
  } else if (VTOModeSettings.occluderType === 'MODEL'){
    return add_hardOccluder(VTOModeSettings);
  } else { // no occluder specified
    return Promise.resolve();
  }
}


function add_hardOccluder(VTOModeSettings){
  return new Promise(function(accept, reject){
    new THREE.GLTFLoader().load(VTOModeSettings.occluderModelURL, function(model){
      const me = model.scene.children[0]; // instance of THREE.Mesh
      me.scale.multiplyScalar(VTOModeSettings.occluderScale);
      
      if (_settings.debugOccluder){
        me.material = new THREE.MeshNormalMaterial();
        return;
      }
      HandTrackerThreeHelper.add_threeOccluder(me);
      accept();
    });
  });
}


function add_softOccluder(VTOModeSettings){
  // add a soft occluder (for the wrist for example):
  const occluderRadius = VTOModeSettings.occluderRadiusRange[1];
  const occluderMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(occluderRadius, occluderRadius, VTOModeSettings.occluderHeight, 32, 1, true),
    new THREE.MeshNormalMaterial()
  );
  const dr = VTOModeSettings.occluderRadiusRange[1] - VTOModeSettings.occluderRadiusRange[0];
  occluderMesh.position.fromArray(VTOModeSettings.occluderOffset);
  occluderMesh.quaternion.fromArray(VTOModeSettings.occluderQuaternion);
  occluderMesh.scale.set(1.0, 1.0, VTOModeSettings.occluderFlattenCoeff);
  HandTrackerThreeHelper.add_threeSoftOccluder(occluderMesh, occluderRadius, dr, _settings.debugOccluder);
  return Promise.resolve();
}


function hide_loading(){
  // remove loading:
  const domLoading = document.getElementById('loading');
  domLoading.style.opacity = 0;
  setTimeout(function(){
    domLoading.parentNode.removeChild(domLoading);
  }, 800);
}


function hide_instructions(){
  const domInstructions = document.getElementById('instructions');
  if (!domInstructions){
    return;
  }
  domInstructions.style.opacity = 0;
  _isInstructionsHidden = true;
  setTimeout(function(){
    domInstructions.parentNode.removeChild(domInstructions);
  }, 800);
}


function change_camera(){
  ChangeCameraHelper.change_camera();
}


function callbackTrack(detectState){
  if (detectState.isDetected) {
    if (!_isInstructionsHidden){
      hide_instructions();
    }
  }
}




window.addEventListener('load', main);