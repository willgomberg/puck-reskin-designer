/*
 * RINK LAYER DEFINITIONS
 * DESCRIPTION: Defines default rink elements, SVG selectors, and default angles.
 * PROCESS: Renderer and Main
 */

// ---------- Rink layers ----------

// NOTE: Gradient angles treat 0deg as to the right (→) and rotates clockwise 
export const rinkLayerDefinitions = {
  ice: {
    name: "Ice",
    defaultLinearGradientDirectionDegrees: 0,
    elements: [
      {
        key: "iceAll",
        name: "Ice surface",
        svgSelector: "#ice-all",
      },
    ],
  },
  faceoffCircles: {
    name: "Faceoff circles",
    defaultLinearGradientDirectionDegrees: 0,
    elements: [
      {
        key: "topLeftCircle",
        name: "Top left circle",
        svgSelector: "#top-left-circle path",
      },
      {
        key: "topRightCircle",
        name: "Top right circle",
        svgSelector: "#top-right-circle path",
      },
      {
        key: "bottomLeftCircle",
        name: "Bottom left circle",
        svgSelector: "#bottom-left-circle path",
      },
      {
        key: "bottomRightCircle",
        name: "Bottom right circle",
        svgSelector: "#bottom-right-circle path",
      },
    ],
  },
  blueLines: {
    name: "Blue lines",
    defaultLinearGradientDirectionDegrees: 90,
    elements: [
      {
        key: "leftBlueLine",
        name: "Left blue line",
        svgSelector: "#left-blue-line",
      },
      {
        key: "rightBlueLine",
        name: "Right blue line",
        svgSelector: "#right-blue-line",
      },
    ],
  },
  neutralZoneDots: {
    name: "Neutral-zone dots",
    defaultLinearGradientDirectionDegrees: 0,
    elements: [
      {
        key: "topLeftNeutralDot",
        name: "Top left neutral-zone dot",
        svgSelector: "#tl-neutral-dot",
      },
      {
        key: "topRightNeutralDot",
        name: "Top right neutral-zone dot",
        svgSelector: "#tr-neutral-dot",
      },
      {
        key: "bottomLeftNeutralDot",
        name: "Bottom left neutral-zone dot",
        svgSelector: "#bl-neutral-dot",
      },
      {
        key: "bottomRightNeutralDot",
        name: "Bottom right neutral-zone dot",
        svgSelector: "#br-neutral-dot",
      },
    ],
  },
  centerCircle: {
    name: "Center circle",
    defaultLinearGradientDirectionDegrees: 0,
    elements: [
      {
        key: "centerDot",
        name: "Center dot",
        svgSelector: "#center-dot",
      },
      {
        key: "cCircle",
        name: "Circle outline",
        svgSelector: "#c-circle path",
      },
    ],
  },
  centerLine: {
    name: "Center line",
    defaultLinearGradientDirectionDegrees: 90,
    elements: [
      {
        key: "centerLine",
        name: "Center line",
        // Both SVG paths belong to this single editable element
        svgSelector: "#center-line > path",
      },
    ],
  },
  goalLines: {
    name: "Goal lines",
    defaultLinearGradientDirectionDegrees: 90,
    elements: [
      {
        key: "leftGoalLine",
        name: "Left goal line",
        svgSelector: "#left-goal-line",
      },
      {
        key: "rightGoalLine",
        name: "Right goal line",
        svgSelector: "#right-goal-line",
      },
    ],
  },
  goalieCreases: {
    name: "Goalie creases",
    defaultLinearGradientDirectionDegrees: 0,
    elements: [
      {
        key: "leftGoalieCrease",
        name: "Left goalie crease",
        svgSelector: "#left-goalie-crease",
      },
      {
        key: "rightGoalieCrease",
        name: "Right goalie crease",
        svgSelector: "#right-goalie-crease",
      },
    ],
  },
};
