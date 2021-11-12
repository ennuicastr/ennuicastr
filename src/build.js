#!/usr/bin/env node
const fs = require("fs");

const browserify = require("browserify");
const browserPackFlat = require("browser-pack-flat");
const tinyify = require("tinyify");
const tsify = require("tsify");

let minify = false;
let noImplicitAny = false;
let main = "src/main.ts";
let standalone = "Ennuicastr";
for (let ai = 2; ai < process.argv.length; ai++) {
    const arg = process.argv[ai];
    if (arg === "-m" || arg === "--minify")
        minify = true;
    else if (arg === "-n" || arg === "--no-implicit-any")
        noImplicitAny = true;
    else if (arg === "-s" || arg === "--standalone")
        standalone = process.argv[++ai];
    else if (arg[0] !== "-")
        main = arg;
    else {
        console.error(`Unrecognized argument ${arg}`);
        process.exit(1);
    }
}
 
if (minify)
    process.stdout.write(fs.readFileSync("src/license.js", "utf8"));
browserify({standalone})
    .add(main)
    .plugin(tsify, { noImplicitAny, files: [] })
    .plugin(minify ? tinyify : browserPackFlat)
    .bundle()
    .on("error", function (error) { console.error(error.toString()); })
    .pipe(process.stdout);
