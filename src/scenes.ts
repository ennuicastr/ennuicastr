/*
 * Copyright (c) 2022 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import interact from "interactjs";

// Serializable data for all scenes
interface ScenesData {
    sceneList: string[];
    scenes: Record<string, SceneData>;
}

// Serializable data for a single scene
interface SceneData {
    objList: string[];
    objs: Record<string, ObjData>;
}

// Serializable data for a single object
interface ObjData {
    type: string;
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * The window in which scenes are displayed
 */
class SceneWindow {
    /**
     * The window in which scenes are to be shown
     */
    window: WindowProxy = null;

    /**
     * The box in the window for the scene itself
     */
    sceneBox: HTMLElement = null;

    /**
     * Data for all scenes
     */
    scenesData: ScenesData = null;

    /**
     * The scene list selector
     */
    sceneListSel: HTMLSelectElement = null;

    /**
     * The current scene
     */
    scene: Scene = null;

    /**
     * The element list selector
     */
    objListSel: HTMLSelectElement = null;

    /**
     * Buttons related to the object list
     */
    objListButtons: {
        add: HTMLButtonElement,
        rem: HTMLButtonElement,
        reset: HTMLButtonElement
    } = null;

    /**
     * Create (or just return) the window
     */
    getWindow() {
        if (this.window && !this.window.closed)
            return this.window;

        const w = this.window = window.open("", "",
            "width=640,height=540,menubar=0,toolbar=0,location=0,personalbar=0,status=0");

        // To make it flex properly, it needs the CSS
        const ssurl = new URL(<any> window.location);
        ssurl.search = "?v=l";
        // eslint-disable-next-line no-useless-escape
        ssurl.pathname = ssurl.pathname.replace(/\/[^\/]*$/, "/ennuicastr2.css");
        w.document.head.innerHTML = '<link href="' + (<any> ssurl) + '" rel="stylesheet" />';

        const dce = w.document.createElement.bind(w.document);

        // The main window is a scene box and an options box
        const b = w.document.body;
        b.innerHTML = "";
        b.classList.add("cflex");
        Object.assign(b.style, {
            margin: "0",
            width: "100%",
            height: "100%"
        });

        const sceneBox = this.sceneBox = dce("div");
        Object.assign(sceneBox.style, {
            flex: "auto",
            backgroundColor: "black",
            overflow: "hidden"
        });
        b.appendChild(sceneBox);

        const optBox = dce("div");
        optBox.classList.add("rflex");
        Object.assign(optBox.style, {
            height: "180px",
            backgroundColor: "#999"
        });
        b.appendChild(optBox);

        // The options box has a scene list, an element selector, and the rest
        const sceneListBox = dce("div");
        sceneListBox.classList.add("cflex");
        Object.assign(sceneListBox.style, {
            flex: "auto",
            height: "100%",
            padding: "0.1em"
        });
        optBox.appendChild(sceneListBox);

        const objListBox = dce("div");
        objListBox.classList.add("cflex");
        Object.assign(objListBox.style, {
            flex: "auto",
            height: "100%",
            padding: "0.1em"
        });
        optBox.appendChild(objListBox);

        const actBox = dce("div");
        actBox.classList.add("cflex");
        Object.assign(actBox.style, {
            flex: "auto",
            height: "100%",
            padding: "0.1em"
        });
        optBox.appendChild(actBox);

        // Make the scene list
        let lbl = dce("label");
        lbl.innerText = "Scene:";
        sceneListBox.appendChild(lbl);
        const sceneList = this.sceneListSel = dce("select");
        sceneList.multiple = true;
        sceneList.style.flex = "auto";
        sceneListBox.appendChild(sceneList);

        // And the object list
        lbl = dce("label");
        lbl.innerText = "Element:";
        objListBox.appendChild(lbl);
        const objList = this.objListSel = dce("select");
        objList.multiple = true;
        objList.style.flex = "auto";
        objListBox.appendChild(objList);

        // With its buttons
        const olbb = dce("div");
        olbb.classList.add("rflex");
        olbb.style.gap = "1em";
        objListBox.appendChild(olbb);
        const olb = this.objListButtons = {
            add: dce("button"),
            rem: dce("button"),
            reset: dce("button")
        };
        olb.add.innerHTML = '<i class="fas fa-plus"></i>';
        olb.add.setAttribute("aria-label", "Add a new element");
        olb.add.style.flex = "auto";
        olbb.appendChid(olb.add);
        olb.rem.innerHTML = '<i class="fas fa-minus"></i>';
        olb.rem.setAttribute("aria-label", "Remove element");
        olb.rem.style.flex = "auto";
        olbb.appendChild(olb.rem);
        olb.reset.innerHTML = '<i class="fas fa-sync"></i>';
        olb.reset.setAttribute("aria-label", "Reset element");
        olb.reset.style.flex = "auto";
        olbb.appendChild(olb.reset);

        // Now load the scene list
        this.loadScenes();

        // And load in the scene
        sceneList.onchange = () => {
            // Ensure only one is selected
            const scene = sceneList.value = sceneList.value;
            this.loadScene(scene);
        }
        this.loadScene(sceneList.value);

        return w;
    }

    // Save scene data
    private saveScenes() {
        localStorage.setItem("ec-scenes", JSON.stringify(this.scenesData));
    }

    // Validate the scenes data
    private validateData() {
        let scenesData = this.scenesData;

        // Basic structure
        if (typeof scenesData !== "object" || scenesData === null) {
            scenesData = this.scenesData = {
                sceneList: [],
                scenes: {}
            };
        }
        let sceneList = scenesData.sceneList;
        if (!(sceneList instanceof Array)) {
            sceneList = scenesData.sceneList = [];
        }
        let scenes = scenesData.scenes;
        if (typeof scenes !== "object" || scenes === null) {
            scenes = scenesData.scenes = {};
        }

        // Make sure all the scenes have string names
        const sceneSet: Record<string, boolean> = Object.create(null);
        for (let i = 0; i < sceneList.length; i++) {
            sceneList[i] = sceneList[i] + "";
            sceneSet[sceneList[i]] = true;
        }

        // Make sure there are no extraneous scenes in the data
        for (const k of Object.keys(scenes)) {
            if (!sceneSet[k])
                delete scenes[k];
        }

        // And validate all the scenes
        for (const scene of sceneList)
            this.validateScene(scene);

        return scenesData;
    }

    // Validate a single scene
    private validateScene(name: string) {
        let sceneData = this.scenesData.scenes[name];
        if (typeof sceneData !== "object" || sceneData == null) {
            sceneData = this.scenesData.scenes[name] = {
                objList: [],
                objs: {}
            };
        }

        // Basics
        let objList = sceneData.objList;
        if (!(objList instanceof Array))
            objList = sceneData.objList = [];
        let objs = sceneData.objs;
        if (typeof objs !== "object" || objs === null)
            objs = sceneData.objs = {};

        // Object names are strings
        const objSet: Record<string, boolean> = Object.create(null);
        for (let i = 0; i < objList.length; i++) {
            objList[i] = objList[i] + "";
            objSet[objList[i]] = true;
        }

        // Remove any unreferenced objects
        for (const k of Object.keys(objs)) {
            if (!objSet[k])
                delete objs[k]
        }

        // And validate the objects
        for (const obj of objList)
            this.validateObj(sceneData, obj);

        return sceneData;
    }

    // Validate (as much as we can of) an object
    private validateObj(sceneData: SceneData, name: string) {
        let obj = sceneData.objs[name];
        if (typeof obj !== "object" || obj === null) {
            obj = sceneData.objs[name] = {
                type: "unknown",
                left: 0,
                top: 0,
                width: 0.25,
                height: 0.25
            };
        }

        // Check the parts
        if (typeof obj.type !== "string")
            obj.type = obj.type + "";
        for (const k of ["left", "top", "width", "height"]) {
            if (typeof obj[k] !== "number")
                obj[k] = parseFloat(obj[k]);
            if (!isFinite(obj[k]))
                obj[k] = 0;
        }

        return obj;
    }

    // Load the scene list and data
    private loadScenes() {
        const dce =
            this.window.document.createElement.bind(this.window.document);

        // Load the data
        let scenesData: ScenesData = {
            sceneList: [],
            scenes: {}
        };
        try {
            let ld: any =
                JSON.parse(localStorage.getItem("ec-scenes"));
            if (ld)
                scenesData = ld;
        } catch (ex) {}
        this.scenesData = scenesData;
        scenesData = this.validateData();

        const sceneList = scenesData.sceneList;

        // If it's empty, make a default scene
        if (sceneList.length === 0)
            this.newScene("Default");

        // Set up the scene list box
        const s = this.sceneListSel;
        s.innerHTML = "";
        for (const scene of sceneList) {
            const o = dce("option");
            o.value = scene;
            o.innerText = scene;
            s.appendChild(o);
        }
        s.value = sceneList[0];

        // Load the scene
    }

    // Create a new scene (but do NOT load it)
    private newScene(name: string) {
        this.scenesData.sceneList.push(name);
        this.validateData();
        this.saveScenes();
    }

    // Load the given scene
    private loadScene(name: string) {
        const sceneData = this.scenesData.scenes[name];
        const scene = this.scene = new Scene(this, sceneData);
        scene.load();
    }
}

/**
 * A loaded scene
 */
class Scene {
    constructor(
        /**
         * The parent window
         */
        public parent: SceneWindow,

        /**
         * Data for this scene
         */
        public data: SceneData
    ) {}

    /**
     * Load this scene
     */
    load() {
        const data = this.data;
        const objList = this.parent.objListSel;
        const dce = this.parent.window.document.createElement.bind(
            this.parent.window.document);

        // Set up the objects
        objList.innerHTML = "";
        for (let i = data.objList.length - 1; i >= 0; i--) {
            const name = data.objList[i];
            const obj = data.objs[name];

            // Add it to the list
            const o = dce("option");
            o.value = name;
            o.innerText = name;
            objList.appendChild(o);
        }
        objList.value = "";
    }
}

/**
 * We only need one actual scene window
 */
export let sceneWindow: SceneWindow = new SceneWindow();
