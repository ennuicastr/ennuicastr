#!/usr/bin/env node
const fs = require("fs");

const browserify = require("browserify");
const browserPackFlat = require("browser-pack-flat");
const tinyify = require("tinyify");
const tsify = require("tsify");

let minify = false;
let noImplicitAny = false;
process.argv.slice(2).forEach((arg) => {
    if (arg === "-m" || arg === "--minify")
        minify = true;
    else if (arg === "-n" || arg === "--no-implicit-any")
        noImplicitAny = true;
    else {
        console.error(`Unrecognized argument ${arg}`);
        process.exit(1);
    }
});
 
process.stdout.write(fs.readFileSync("src/license.js", "utf8"));
browserify({standalone: "Ennuicastr"})
    .add("src/main.ts")
    .plugin(tsify, { noImplicitAny, files: [] })
    .plugin(minify ? tinyify : browserPackFlat)
    .bundle()
    .on("error", function (error) { console.error(error.toString()); })
    .pipe(process.stdout);
