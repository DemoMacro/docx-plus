import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { unzipSync } from "fflate";

const main = () => {
    const zip = readFileSync("My Document.docx");
    const data = unzipSync(zip);
    const outputDir = "build/extracted-doc";

    mkdirSync(outputDir, { recursive: true });

    for (const [relativePath, fileData] of Object.entries(data)) {
        const filePath = join(outputDir, relativePath);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, fileData);
    }
};

main();
