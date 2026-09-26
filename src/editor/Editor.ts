import * as Y from "yjs";
// @ts-ignore because no typings
import { yCollab } from "y-codemirror.next";
import { WebrtcProvider } from "y-webrtc";

import { ChangeSpec, EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { keymap } from "@codemirror/view";
import { RegExpCursor } from "@codemirror/search";
import { linter, lintGutter } from "@codemirror/lint";

// @ts-ignore because no typings
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";

import debounce from "lodash/debounce";
import { matchComponentRegex, matchEdgeRegex } from "../parser/TogetherParser";

import {
  removeFromSelection,
  addToSelection,
  setEditorText,
  state,
  subscribe,
  clearSelection,
} from "../state/State";
import MapSingleton from "../map/components/MapSingleton";
import { togetherScriptLinter } from "./TogetherScriptLinter";
import { generateRandomAnimal } from "../user/utilities/generateRandomAnimal";
import { rerenderGraph } from "../state/Graph";
import { nanoid } from "../app/utilities/NanoId";

let room = document.location.pathname.replace("/", "");
if (!room) {
  room = nanoid(8);
  history.replaceState({}, "", room);
}

const Theme = EditorView.theme({
  "&": {
    fontSize: "1rem",
  },
  ".cm-content": {
    fontFamily: "'JetBrains Mono', Consolas, Courier New, monospace",
    fontWeight: "400",
    cursor: "text",
  },
  ".cm-scroller": {
    fontFamily: "'JetBrains Mono', Consolas, Courier New, monospace",
    fontWeight: "400",
  },
  ".cm-gutters": {
    color: "#d0d0d0",
    backgroundColor: "transparent",
    borderRight: "none",
  },
  ".cm-gutterElement": {
    userSelect: "none",
  },
  ".cm-ySelectionInfo": {
    fontFamily: "'JetBrains Mono', Consolas, Courier New, monospace",
    fontWeight: "400",
    color: "black",
  },
});

export const userColors = [
  { color: "#30bced", light: "#30bced33" },
  { color: "#6eeb83", light: "#6eeb8333" },
  { color: "#ffbc42", light: "#ffbc4233" },
  { color: "#ecd444", light: "#ecd44433" },
  { color: "#ee6352", light: "#ee635233" },
  { color: "#9ac2c9", light: "#9ac2c933" },
  { color: "#8acb88", light: "#8acb8833" },
  { color: "#1be7ff", light: "#1be7ff33" },
];

export const userColor =
  userColors[Math.floor(Math.random() * userColors.length)];

const yDoc = new Y.Doc();
const yText = yDoc.getText("maptogether");

export const multiplayerClientID = yDoc.clientID;

export const undoManager = new Y.UndoManager(yText, { captureTimeout: 350 });

// @ts-ignore because Typing error in WebrtcProvider
const provider = new WebrtcProvider(`MapTogether${room}`, yDoc, {
  password: "isnh388u3unhuie",
  signaling: [
    "wss://y-webrtc-eu.fly.dev",
  ],
});

let username = localStorage.getItem("username");
if (!username) {
  username = generateRandomAnimal();
  localStorage.setItem("username", username);
}

window.heap.identify(username);

provider.awareness.setLocalStateField("user", {
  name: username,
  color: userColor.color,
  colorLight: userColor.light,
});

// provider.awareness.on("change", (change: any, origin: any) => {
//   console.log(change, origin);
// });

const linterExtension = linter(togetherScriptLinter());

const startState = EditorState.create({
  doc: yText.toString(),
  extensions: [
    keymap.of(vscodeKeymap),
    basicSetup,
    linterExtension,
    lintGutter(),
    EditorView.lineWrapping,
    Theme,
    yCollab(yText, provider.awareness, { undoManager }),
    EditorView.updateListener.of((e) => {
      if (e.docChanged) {
        handleEditorChange(e.state.doc.toString());
      }
    }),
  ],
});

export const editorView = new EditorView({
  state: startState,
  parent: document.getElementById("editor")!,
});

/* ========= Actions ========= */
export const enableErrorMode = (): void => {
  const editorDiv = document.getElementById("editor");
  editorDiv!.style.backgroundColor = "rgba(255, 0, 0, 0.05)";
};

export const disableErrorMode = (): void => {
  const editorDiv = document.getElementById("editor");
  editorDiv!.style.backgroundColor = "transparent";
};

export const appendText = (text: string) => {
  editorView.dispatch({
    changes: {
      from: editorView.state.doc.length,
      insert: text,
    },
    selection: {
      anchor: editorView.state.doc.length + text.length,
    },
  });
};

export const replaceCoordinates = (
  componentName: string,
  x: number,
  y: number
) => {
  const searchCursor = new RegExpCursor(
    editorView.state.doc,
    matchComponentRegex(componentName),
    {}
  );

  let changes = [];
  var coords = MapSingleton.rendererToWardleyCoords(x, y);

  for (const next of searchCursor) {
    const to =
      next.from +
      next.match.slice(1, 6).reduce((prev, current) => {
        if (current) {
          return prev + current.length;
        } else {
          return prev;
        }
      }, 0);

    changes.push({
      from: next.from,
      to,
      insert: `${next.match[1] || ""}${next.match[2]}${next.match[3] || ""}${
        next.match[4] || ""
      }[${coords[1]},${coords[0]}]`, // TODO: should be coming from Parser
    });
  }

  if (changes.length === 0) {
    throw new Error(
      `Error: "${componentName}" not found in text document. State sync lost or regex error.`
    );
  }

  editorView.dispatch({
    changes,
    // selection: { anchor: changes[changes.length - 1].from + changes[changes.length -1].insert.length },
  });
};

export const renameComponent = (oldName: string, newName: string) => {
  let changes: ChangeSpec[] = [];

  const componentSearchCursor = new RegExpCursor(
    editorView.state.doc,
    matchComponentRegex(oldName),
    {}
  );

  for (const next of componentSearchCursor) {
    const to =
      next.from +
      next.match.slice(2, 3).reduce((prev, current) => {
        if (current) {
          return prev + current.length;
        } else {
          return prev;
        }
      }, 0);

    changes.push({
      from: next.from,
      to,
      insert: `${newName}`,
    });
  }

  const edgeSearchCursor = new RegExpCursor(
    editorView.state.doc,
    matchEdgeRegex(oldName),
    {}
  );

  for (const next of edgeSearchCursor) {
    let from = next.from;
    let to = next.from;

    // LHS Match
    if (next.match[2]) {
      const lhsWs = next.match[1] ? next.match[1].length : 0;
      const lhsComponentIdentifier = next.match[2].length;
      // const lhsWs2 = next.match[3] ? next.match[3].length : 0
      // const lhsRest = next.match[4].length

      from += lhsWs;
      to = from + lhsComponentIdentifier;

      //RHS Match
    } else if (next.match[9]) {
      const rhsRest = next.match[5].length;
      const rhsDotAttributes = next.match[6].length;
      const rhsWs = next.match[8] ? next.match[8].length : 0;
      const rhsComponentIdentifier = next.match[9].length;
      // const rhsWs2 = next.match[10] ? next.match[10].length : 0
      // const rhsComment = next.match[11] ? next.match[11].length : 0

      from += rhsRest + rhsDotAttributes + rhsWs;
      to = from + rhsComponentIdentifier;
    } else {
      throw new Error(
        "Error: this shouldn't be reached. Check if regex has changed."
      );
    }

    changes.push({
      from,
      to,
      insert: newName,
    });
  }

  if (changes.length === 0) {
    throw new Error(
      `RenameComponentError: "${oldName}" not found in text document. State sync lost or regex error.`
    );
  }

  // update the selection if there is one
  if (removeFromSelection(oldName)) {
    addToSelection([newName]);
  }

  editorView.dispatch({
    changes,
  });
};

export const deleteComponents = (names: string[]) => {
  if (names.length === 0) return;

  let changes: ChangeSpec[] = [];

  names.forEach((name: string) => {
    const componentSearchCursor = new RegExpCursor(
      editorView.state.doc,
      matchComponentRegex(name),
      {}
    );

    for (const next of componentSearchCursor) {
      changes.push({
        from: next.from,
        to: next.to,
        insert: "",
      });
    }

    const edgeSearchCursor = new RegExpCursor(
      editorView.state.doc,
      matchEdgeRegex(name),
      {}
    );

    for (const next of edgeSearchCursor) {
      // NOTE: may need to revise regex to match full line of edge.
      changes.push({
        from: next.from,
        to: next.to,
        insert: "",
      });
    }
  });

  if (changes.length === 0) {
    throw new Error(
      `RenameComponentError: "${names}" not found in text document. State sync lost or regex error.`
    );
  }

  clearSelection();

  editorView.dispatch({
    changes,
  });
};

/* ======== Events ======== */
// Save editor state to browser storage before navigating away
window.addEventListener("beforeunload", function (e) {
  localStorage.setItem("editorText", editorView.state.doc.toString());
});

const handleEditorChange = debounce((text: string) => {
  setEditorText(text);
}, 32);

// SUBSCRIPTIONS
subscribe(state.editor, () => {
  // TODO: read lazy update checking to see if text makes a different graph than before
  // Rerendering each time might be faster than diffing graph?

  //   if (state.ast.astArr.length !== state.lastAst.astArr.length) {
  //     state.lastAst.astArr = state.ast.astArr;
  //     rerenderGraph();
  //     return;
  //   }

  //   for (let i = 0; i < state.ast.astArr.length; i++) {
  //     if (state.ast.astArr[i].type !== state.lastAst.astArr[i].type) {
  //       state.lastAst.astArr = state.ast.astArr;
  //       rerenderGraph();
  //       return;
  //     } else if (!isEqual(state.ast.astArr[i], state.lastAst.astArr[i])) {
  //       state.lastAst.astArr = state.ast.astArr;
  //       rerenderGraph();
  //       return;
  //     }
  //   }

  rerenderGraph();
}); // <-State
