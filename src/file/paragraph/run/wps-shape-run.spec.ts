import { Formatter } from "@export/formatter";
import type { IViewWrapper } from "@file/document-wrapper";
import type { File } from "@file/file";
import { Paragraph } from "@file/index";
import { describe, it } from "vite-plus/test";

import { WpsShapeRun } from "./wps-shape-run";

describe("WpsShapeRun", () => {
    describe("#constructor()", () => {
        it("should create with Buffer", () => {
            const currentShapeRun = new WpsShapeRun({
                children: [new Paragraph("Test Paragraph")],
                floating: {
                    horizontalPosition: {
                        offset: 1_014_400,
                    },
                    verticalPosition: {
                        offset: 1_014_400,
                    },
                    zIndex: 10,
                },
                solidFill: {
                    value: "FF0000",
                },
                transformation: {
                    height: 200,
                    rotation: 45,
                    width: 200,
                },
                type: "wps",
            });

            const tree = new Formatter().format(currentShapeRun, {
                file: {
                    Media: {},
                } as unknown as File,
                stack: [],
                viewWrapper: {} as unknown as IViewWrapper,
            });

            console.log(JSON.stringify(tree, null, 2));

            // Expect(tree).to.deep.equal({
            //     "w:r": [
            //         {
            //             "w:drawing": [
            //                 {
            //                     "wp:anchor": [
            //                         {
            //                             _attr: {
            //                                 AllowOverlap: "1",
            //                                 BehindDoc: "0",
            //                                 DistB: 0,
            //                                 DistL: 0,
            //                                 DistR: 0,
            //                                 DistT: 0,
            //                                 LayoutInCell: "1",
            //                                 Locked: "0",
            //                                 RelativeHeight: 10,
            //                                 SimplePos: "0",
            //                             },
            //                         },
            //                         {
            //                             "wp:simplePos": {
            //                                 _attr: {
            //                                     X: 0,
            //                                     Y: 0,
            //                                 },
            //                             },
            //                         },
            //                         {
            //                             "wp:positionH": [
            //                                 {
            //                                     _attr: {
            //                                         RelativeFrom: "page",
            //                                     },
            //                                 },
            //                                 {
            //                                     "wp:posOffset": ["1014400"],
            //                                 },
            //                             ],
            //                         },
            //                         {
            //                             "wp:positionV": [
            //                                 {
            //                                     _attr: {
            //                                         RelativeFrom: "page",
            //                                     },
            //                                 },
            //                                 {
            //                                     "wp:posOffset": ["1014400"],
            //                                 },
            //                             ],
            //                         },
            //                         {
            //                             "wp:extent": {
            //                                 _attr: {
            //                                     Cx: 1905000,
            //                                     Cy: 1905000,
            //                                 },
            //                             },
            //                         },
            //                         {
            //                             "wp:effectExtent": {
            //                                 _attr: {
            //                                     B: 0,
            //                                     L: 0,
            //                                     R: 0,
            //                                     T: 0,
            //                                 },
            //                             },
            //                         },
            //                         {
            //                             "wp:wrapNone": {},
            //                         },
            //                         {
            //                             "wp:docPr": {
            //                                 _attr: {
            //                                     Descr: "",
            //                                     Id: 1,
            //                                     Name: "",
            //                                     Title: "",
            //                                 },
            //                             },
            //                         },
            //                         {
            //                             "wp:cNvGraphicFramePr": [
            //                                 {
            //                                     "a:graphicFrameLocks": {
            //                                         _attr: {
            //                                             NoChangeAspect: 1,
            //                                             "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            //                                         },
            //                                     },
            //                                 },
            //                             ],
            //                         },
            //                         {
            //                             "a:graphic": [
            //                                 {
            //                                     _attr: {
            //                                         "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            //                                     },
            //                                 },
            //                                 {
            //                                     "a:graphicData": [
            //                                         {
            //                                             _attr: {
            //                                                 Uri: "http://schemas.openxmlformats.org/drawingml/2006/picture",
            //                                             },
            //                                         },
            //                                         {
            //                                             "pic:pic": [
            //                                                 {
            //                                                     _attr: {
            //                                                         "xmlns:pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
            //                                                     },
            //                                                 },
            //                                                 {
            //                                                     "pic:nvPicPr": [
            //                                                         {
            //                                                             "pic:cNvPr": {
            //                                                                 _attr: {
            //                                                                     Descr: "",
            //                                                                     Id: 0,
            //                                                                     Name: "",
            //                                                                 },
            //                                                             },
            //                                                         },
            //                                                         {
            //                                                             "pic:cNvPicPr": [
            //                                                                 {
            //                                                                     "a:picLocks": {
            //                                                                         _attr: {
            //                                                                             NoChangeArrowheads: 1,
            //                                                                             NoChangeAspect: 1,
            //                                                                         },
            //                                                                     },
            //                                                                 },
            //                                                             ],
            //                                                         },
            //                                                     ],
            //                                                 },
            //                                                 {
            //                                                     "pic:blipFill": [
            //                                                         {
            //                                                             "a:blip": {
            //                                                                 _attr: {
            //                                                                     Cstate: "none",
            //                                                                     "r:embed":
            //                                                                         "rId{da39a3ee5e6b4b0d3255bfef95601890afd80709.png}",
            //                                                                 },
            //                                                             },
            //                                                         },
            //                                                         {
            //                                                             "a:srcRect": {},
            //                                                         },
            //                                                         {
            //                                                             "a:stretch": [
            //                                                                 {
            //                                                                     "a:fillRect": {},
            //                                                                 },
            //                                                             ],
            //                                                         },
            //                                                     ],
            //                                                 },
            //                                                 {
            //                                                     "pic:spPr": [
            //                                                         {
            //                                                             _attr: {
            //                                                                 BwMode: "auto",
            //                                                             },
            //                                                         },
            //                                                         {
            //                                                             "a:xfrm": [
            //                                                                 {
            //                                                                     _attr: {
            //                                                                         Rot: 2700000,
            //                                                                     },
            //                                                                 },
            //                                                                 {
            //                                                                     "a:off": {
            //                                                                         _attr: {
            //                                                                             X: 0,
            //                                                                             Y: 0,
            //                                                                         },
            //                                                                     },
            //                                                                 },
            //                                                                 {
            //                                                                     "a:ext": {
            //                                                                         _attr: {
            //                                                                             Cx: 1905000,
            //                                                                             Cy: 1905000,
            //                                                                         },
            //                                                                     },
            //                                                                 },
            //                                                             ],
            //                                                         },
            //                                                         {
            //                                                             "a:prstGeom": [
            //                                                                 {
            //                                                                     _attr: {
            //                                                                         Prst: "rect",
            //                                                                     },
            //                                                                 },
            //                                                                 {
            //                                                                     "a:avLst": {},
            //                                                                 },
            //                                                             ],
            //                                                         },
            //                                                     ],
            //                                                 },
            //                                             ],
            //                                         },
            //                                     ],
            //                                 },
            //                             ],
            //                         },
            //                     ],
            //                 },
            //             ],
            //         },
            //     ],
            // });
        });
    });
});
