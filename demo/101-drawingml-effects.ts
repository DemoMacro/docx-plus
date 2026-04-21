// DrawingML Advanced Features - image cropping, effects, 3D, gradient fill, enhanced outline
import * as fs from "fs";

import { Document, ImageRun, Packer, Paragraph, TextRun, WpsShapeRun } from "docx-plus";

const doc = new Document({
    sections: [
        {
            children: [
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            size: 32,
                            text: "DrawingML Advanced Features",
                        }),
                    ],
                    spacing: { after: 400 },
                }),

                // 1. Image cropping (srcRect)
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "1. Image Cropping (srcRect)",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [new TextRun("Original image:")],
                    spacing: { after: 100 },
                }),
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: fs.readFileSync("./demo/images/cat.jpg"),
                            transformation: {
                                height: 150,
                                width: 150,
                            },
                            type: "jpg",
                        }),
                    ],
                }),
                new Paragraph({
                    children: [new TextRun("Cropped 25% from left and right:")],
                    spacing: { after: 100 },
                }),
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: fs.readFileSync("./demo/images/cat.jpg"),
                            srcRect: { left: 25000, right: 25000 },
                            transformation: {
                                height: 150,
                                width: 150,
                            },
                            type: "jpg",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 2. Shadow effects
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "2. Shadow Effects",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [new TextRun("Outer Shadow")],
                                }),
                            ],
                            effects: {
                                outerShadow: {
                                    blurRad: 50800,
                                    color: { value: "000000" },
                                    dist: 38100,
                                    dir: 5400000,
                                },
                            },
                            outline: {
                                color: { value: "4472C4" },
                                type: "solidFill",
                                width: 12_700,
                            },
                            solidFill: { value: "D9E2F3" },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 3. Glow effect
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "3. Glow Effect",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [
                                        new TextRun({
                                            bold: true,
                                            color: "FFFFFF",
                                            text: "Glowing Box",
                                        }),
                                    ],
                                }),
                            ],
                            effects: {
                                glow: { color: { value: "00B0F0" }, rad: 76200 },
                            },
                            outline: {
                                color: { value: "0070C0" },
                                type: "solidFill",
                                width: 12_700,
                            },
                            solidFill: { value: "0070C0" },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 4. Reflection effect
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "4. Reflection Effect",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [new TextRun("Reflection")],
                                }),
                            ],
                            effects: {
                                reflection: {
                                    blurRad: 6350,
                                    dist: 38100,
                                    fadeDir: 5400000,
                                    stA: 40000,
                                },
                            },
                            outline: {
                                color: { value: "ED7D31" },
                                type: "solidFill",
                                width: 12_700,
                            },
                            solidFill: { value: "F4B183" },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 5. Gradient fill (linear)
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "5. Gradient Fill (Linear)",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [
                                        new TextRun({
                                            bold: true,
                                            color: "FFFFFF",
                                            text: "Linear Gradient",
                                        }),
                                    ],
                                }),
                            ],
                            gradientFill: {
                                shade: { angle: 5400000 },
                                stops: [
                                    { color: { value: "002060" }, position: 0 },
                                    { color: { value: "0070C0" }, position: 50000 },
                                    { color: { value: "00B0F0" }, position: 100000 },
                                ],
                            },
                            outline: {
                                color: { value: "002060" },
                                type: "solidFill",
                                width: 12_700,
                            },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 6. Gradient fill (radial/path)
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "6. Gradient Fill (Radial)",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [
                                        new TextRun({
                                            bold: true,
                                            text: "Radial Gradient",
                                        }),
                                    ],
                                }),
                            ],
                            gradientFill: {
                                shade: { path: "CIRCLE" },
                                stops: [
                                    { color: { value: "FFFFFF" }, position: 0 },
                                    { color: { value: "4472C4" }, position: 100000 },
                                ],
                            },
                            outline: {
                                color: { value: "2F5496" },
                                type: "solidFill",
                                width: 12_700,
                            },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 7. Soft edge effect
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "7. Soft Edge Effect",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [new TextRun("Soft Edge")],
                                }),
                            ],
                            effects: {
                                softEdge: 50800,
                            },
                            solidFill: { value: "70AD47" },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 8. 3D shape with bevel and material
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "8. 3D Shape (Bevel + Material)",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [new TextRun("3D Effect")],
                                }),
                            ],
                            shape3d: {
                                bevelT: { prst: "CIRCLE", w: 76200, h: 76200 },
                                extrusionColor: { value: "2F5496" },
                                prstMaterial: "PLASTIC",
                                z: 76200,
                            },
                            solidFill: { value: "4472C4" },
                            transformation: {
                                height: 120,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                new Paragraph({ children: [new TextRun("")] }),

                // 9. Combined effects
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "9. Combined Effects (Shadow + Reflection + Gradient)",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [
                                        new TextRun({
                                            bold: true,
                                            color: "FFFFFF",
                                            text: "All Together!",
                                        }),
                                    ],
                                }),
                            ],
                            effects: {
                                outerShadow: {
                                    blurRad: 40000,
                                    color: { value: "000000" },
                                    dist: 30000,
                                    dir: 5400000,
                                },
                                reflection: {
                                    blurRad: 4000,
                                    dist: 20000,
                                    fadeDir: 5400000,
                                    stA: 30000,
                                },
                            },
                            gradientFill: {
                                shade: { angle: 2700000 },
                                stops: [
                                    { color: { value: "1F4E79" }, position: 0 },
                                    { color: { value: "2E75B6" }, position: 50000 },
                                    { color: { value: "9DC3E6" }, position: 100000 },
                                ],
                            },
                            outline: {
                                color: { value: "1F4E79" },
                                type: "solidFill",
                                width: 12_700,
                            },
                            transformation: {
                                height: 120,
                                width: 400,
                            },
                            type: "wps",
                        }),
                    ],
                }),

                // 10. Enhanced outline (dash style + line join)
                new Paragraph({ children: [new TextRun("")] }),
                new Paragraph({
                    children: [
                        new TextRun({
                            bold: true,
                            text: "10. Enhanced Outline (Dash + Join)",
                        }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new WpsShapeRun({
                            children: [
                                new Paragraph({
                                    alignment: "center",
                                    children: [new TextRun("Dashed Outline")],
                                }),
                            ],
                            outline: {
                                color: { value: "C00000" },
                                dash: "DASH",
                                join: "ROUND",
                                type: "solidFill",
                                width: 25_400,
                            },
                            solidFill: { value: "FFF2CC" },
                            transformation: {
                                height: 80,
                                width: 300,
                            },
                            type: "wps",
                        }),
                    ],
                }),
            ],
        },
    ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync("My Document.docx", buffer);
