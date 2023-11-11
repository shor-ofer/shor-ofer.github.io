var shouldersDistance = 0.5,
upperArmLength = 0.4,
lowerArmLength = 0.4,
upperArmSize = 0.2,
lowerArmSize = 0.2,
neckLength = 0.1,
headRadius = 0.25,
upperBodyLength = 0.6,
pelvisLength = 0.4,
upperLegLength = 0.5,
upperLegSize = 0.2,
lowerLegSize = 0.2,
lowerLegLength = 0.5;

function createApp(container)
{
// Create demo application
var app = new p2.WebGLRenderer(function(){

var OTHER =     Math.pow(2,1),
    BODYPARTS = Math.pow(2,2),
    GROUND =    Math.pow(2,3),
    OTHER =     Math.pow(2,4),
    bodyPartShapes = [];

var headShape = new p2.Circle({ radius: headRadius });
    var s=1.0,
    upperArmShapeLeft = new p2.Box({ width: s*upperArmLength, height: s*upperArmSize }),
    upperArmShapeRight = new p2.Box({ width: s*upperArmLength, height: s*upperArmSize }),
    lowerArmShapeLeft = new p2.Box({ width: s*lowerArmLength, height: s*lowerArmSize }),
    lowerArmShapeRight = new p2.Box({ width: s*lowerArmLength, height: s*lowerArmSize }),
    upperBodyShape = new p2.Box({ width: s*shouldersDistance, height: s*upperBodyLength }),
    pelvisShape = new p2.Box({ width: s*shouldersDistance, height: s*pelvisLength }),
    upperLegShapeLeft = new p2.Box({ width: s*upperLegSize, height: s*upperLegLength }),
    upperLegShapeRight = new p2.Box({ width: s*upperLegSize, height: s*upperLegLength }),
    lowerLegShapeLeft = new p2.Box({ width: s*lowerLegSize, height: s*lowerLegLength }),
    lowerLegShapeRight = new p2.Box({ width: s*lowerLegSize, height: s*lowerLegLength });

bodyPartShapes.push(
    headShape,
    upperArmShapeRight,
    upperArmShapeLeft,
    lowerArmShapeRight,
    lowerArmShapeLeft,
    upperBodyShape,
    pelvisShape,
    upperLegShapeRight,
    upperLegShapeLeft,
    lowerLegShapeRight,
    lowerLegShapeLeft
);

for(var i=0; i<bodyPartShapes.length; i++){
    var s = bodyPartShapes[i];
    s.collisionGroup = BODYPARTS;
    s.collisionMask = GROUND|OTHER;
}

var world = new p2.World({
    gravity : [0,-10]
});

this.setWorld(world);

world.solver.iterations = 100;
world.solver.tolerance = 0.002;

// Lower legs
var lowerLeftLeg = new p2.Body({
    mass: 1,
    position: [-shouldersDistance/2,lowerLegLength / 2],
});
var lowerRightLeg = new p2.Body({
    mass: 1,
    position: [shouldersDistance/2,lowerLegLength / 2],
});
lowerLeftLeg.addShape(lowerLegShapeLeft);
lowerRightLeg.addShape(lowerLegShapeRight);
world.addBody(lowerLeftLeg);
world.addBody(lowerRightLeg);

// Upper legs
var upperLeftLeg = new p2.Body({
    mass: 1,
    position: [-shouldersDistance/2,lowerLeftLeg.position[1]+lowerLegLength/2+upperLegLength / 2],
});
var upperRightLeg = new p2.Body({
    mass: 1,
    position: [shouldersDistance/2,lowerRightLeg.position[1]+lowerLegLength/2+upperLegLength / 2],
});
upperLeftLeg.addShape(upperLegShapeLeft);
upperRightLeg.addShape(upperLegShapeRight);
world.addBody(upperLeftLeg);
world.addBody(upperRightLeg);

// Pelvis
var pelvis = new p2.Body({
    mass: 1,
    position: [0, upperLeftLeg.position[1]+upperLegLength/2+pelvisLength/2],
});
pelvis.addShape(pelvisShape);
world.addBody(pelvis);

// Upper body
var upperBody = new p2.Body({
    mass: 1,
    position: [0,pelvis.position[1]+pelvisLength/2+upperBodyLength/2],
});
upperBody.addShape(upperBodyShape);
world.addBody(upperBody);

// Head
var head = new p2.Body({
    mass: 0,
    position: [0,upperBody.position[1]+upperBodyLength/2+headRadius+neckLength],
});
head.addShape(headShape);
world.addBody(head);

// Upper arms
var upperLeftArm = new p2.Body({
    mass: 1,
    position: [-shouldersDistance/2-upperArmLength/2, upperBody.position[1]+upperBodyLength/2],
});
var upperRightArm = new p2.Body({
    mass: 1,
    position: [shouldersDistance/2+upperArmLength/2, upperBody.position[1]+upperBodyLength/2],
});
upperLeftArm.addShape(upperArmShapeLeft);
upperRightArm.addShape(upperArmShapeRight);
world.addBody(upperLeftArm);
world.addBody(upperRightArm);

// lower arms
var lowerLeftArm = new p2.Body({
    mass: 1,
    position: [ upperLeftArm.position[0] - lowerArmLength/2 - upperArmLength/2,
                upperLeftArm.position[1]],
});
var lowerRightArm = new p2.Body({
    mass: 1,
    position: [ upperRightArm.position[0] + lowerArmLength/2 + upperArmLength/2,
                upperRightArm.position[1]],
});
lowerLeftArm.addShape(lowerArmShapeLeft);
lowerRightArm.addShape(lowerArmShapeRight);
world.addBody(lowerLeftArm);
world.addBody(lowerRightArm);


// Neck joint
var neckJoint = new p2.RevoluteConstraint(head, upperBody, {
    localPivotA: [0,-headRadius-neckLength/2],
    localPivotB: [0,upperBodyLength/2],
});
neckJoint.setLimits(-Math.PI / 8, Math.PI / 8);
world.addConstraint(neckJoint);

// Knee joints
var leftKneeJoint = new p2.RevoluteConstraint(lowerLeftLeg, upperLeftLeg, {
    localPivotA: [0, lowerLegLength/2],
    localPivotB: [0,-upperLegLength/2],
});
var rightKneeJoint= new p2.RevoluteConstraint(lowerRightLeg, upperRightLeg, {
    localPivotA: [0, lowerLegLength/2],
    localPivotB:[0,-upperLegLength/2],
});
leftKneeJoint.setLimits(-Math.PI / 8, Math.PI / 8);
rightKneeJoint.setLimits(-Math.PI / 8, Math.PI / 8);
world.addConstraint(leftKneeJoint);
world.addConstraint(rightKneeJoint);

// Hip joints
var leftHipJoint = new p2.RevoluteConstraint(upperLeftLeg, pelvis, {
    localPivotA: [0, upperLegLength/2],
    localPivotB: [-shouldersDistance/2,-pelvisLength/2],
});
var rightHipJoint = new p2.RevoluteConstraint(upperRightLeg, pelvis, {
    localPivotA: [0, upperLegLength/2],
    localPivotB: [shouldersDistance/2,-pelvisLength/2],
});
leftHipJoint.setLimits(-Math.PI / 8, Math.PI / 8);
rightHipJoint.setLimits(-Math.PI / 8, Math.PI / 8);
world.addConstraint(leftHipJoint);
world.addConstraint(rightHipJoint);

// Spine
var spineJoint = new p2.RevoluteConstraint(pelvis, upperBody, {
    localPivotA: [0,pelvisLength/2],
    localPivotB: [0,-upperBodyLength/2],
});
spineJoint.setLimits(-Math.PI / 8, Math.PI / 8);
world.addConstraint(spineJoint);

// Shoulders
var leftShoulder = new p2.RevoluteConstraint(upperBody, upperLeftArm, {
    localPivotA:[-shouldersDistance/2, upperBodyLength/2],
    localPivotB:[upperArmLength/2,0],
});
var rightShoulder= new p2.RevoluteConstraint(upperBody, upperRightArm, {
    localPivotA:[shouldersDistance/2,  upperBodyLength/2],
    localPivotB:[-upperArmLength/2,0],
});
leftShoulder.setLimits(-Math.PI / 3, Math.PI / 3);
rightShoulder.setLimits(-Math.PI / 3, Math.PI / 3);
world.addConstraint(leftShoulder);
world.addConstraint(rightShoulder);

// Elbow joint
var leftElbowJoint = new p2.RevoluteConstraint(lowerLeftArm, upperLeftArm, {
    localPivotA: [lowerArmLength/2, 0],
    localPivotB: [-upperArmLength/2,0],
});
var rightElbowJoint= new p2.RevoluteConstraint(lowerRightArm, upperRightArm, {
    localPivotA:[-lowerArmLength/2,0],
    localPivotB:[upperArmLength/2,0],
});
leftElbowJoint.setLimits(-Math.PI / 8, Math.PI / 8);
rightElbowJoint.setLimits(-Math.PI / 8, Math.PI / 8);
world.addConstraint(leftElbowJoint);
world.addConstraint(rightElbowJoint);

// Create ground
var planeShape = new p2.Plane();
var plane = new p2.Body({
    position:[0,-1],
});
plane.addShape(planeShape);
planeShape.collisionGroup = GROUND;
planeShape.collisionMask =  BODYPARTS|OTHER;
world.addBody(plane);

// nullBody = new p2.Body();
// world.addBody(this.nullBody);
// headConstraint = new p2.RevoluteConstraint(this.nullBody, head, {
//     localPivotA: [0,0],
//     localPivotB: [0,0],
//     maxForce:10
// });
window.head = head;

head.position=[0,0];
var newpos=[0,0]

// window.setInterval(()=>{newpos=[Math.random()*3-1.5,Math.random()*3+1]},500);
// window.setInterval(()=>{head.position=[head.position[0]+(newpos[0]-head.position[0])*0.1,
//                                        head.position[1]+(newpos[1]-head.position[1])*0.1];},10 );
//world.addConstraint(headConstraint);


// head.gravityScale=0;
// head.damping=1;
// world.on("postStep", function (e) {
//     //if (window.lala==undefined)
//     //window.lala= head.position;

      
//     //head.applyForce([0.0,150])
// })

this.newShapeCollisionGroup = OTHER;
this.newShapeCollisionMask =  BODYPARTS|OTHER|GROUND;
},{container:container,width:300,height:300});

return app;
}