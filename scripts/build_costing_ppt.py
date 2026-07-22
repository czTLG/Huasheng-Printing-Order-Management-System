#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


EMU_PER_INCH = 914400
SLIDE_W = 13.333333 * EMU_PER_INCH
SLIDE_H = 7.5 * EMU_PER_INCH


def qn(tag: str) -> str:
    return tag


def xml_declaration(body: str) -> bytes:
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body).encode('utf-8')


def rels_xml(relations):
    items = []
    for rId, rel_type, target in relations:
        items.append(
            f'<Relationship Id="{rId}" '
            f'Type="{rel_type}" Target="{escape(target)}"/>'
        )
    return xml_declaration(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + ''.join(items)
        + '</Relationships>'
    )


def content_types_xml(slide_count: int):
    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    ]
    for i in range(1, slide_count + 1):
        overrides.append(
            f'<Override PartName="/ppt/slides/slide{i}.xml" '
            f'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        )
    return xml_declaration(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        + ''.join(overrides)
        + '</Types>'
    )


def presentation_xml(slide_count: int):
    slide_ids = []
    for idx in range(1, slide_count + 1):
        slide_ids.append(
            f'<p:sldId id="{256 + idx}" r:id="rId{idx + 1}"/>'
        )
    return xml_declaration(
        '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
        '<p:sldSz cx="{w}" cy="{h}"/><p:notesSz cx="6858000" cy="9144000"/>'
        '<p:sldIdLst>{ids}</p:sldIdLst>'
        '</p:presentation>'.format(w=int(SLIDE_W), h=int(SLIDE_H), ids=''.join(slide_ids))
    )


def slide_master_xml():
    return xml_declaration(
        '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        '</p:spTree></p:cSld>'
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
        '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>'
        '</p:sldMaster>'
    )


def slide_layout_xml():
    return xml_declaration(
        '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">'
        '<p:cSld name="Blank Layout"><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        '</p:spTree></p:cSld>'
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
        '</p:sldLayout>'
    )


def theme_xml():
    return xml_declaration(
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">'
        '<a:themeElements>'
        '<a:clrScheme name="Office">'
        '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
        '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
        '<a:dk2><a:srgbClr val="1F497D"/></a:dk2>'
        '<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>'
        '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>'
        '<a:accent2><a:srgbClr val="C0504D"/></a:accent2>'
        '<a:accent3><a:srgbClr val="9BBB59"/></a:accent3>'
        '<a:accent4><a:srgbClr val="8064A2"/></a:accent4>'
        '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5>'
        '<a:accent6><a:srgbClr val="F79646"/></a:accent6>'
        '<a:hlink><a:srgbClr val="0000FF"/></a:hlink>'
        '<a:folHlink><a:srgbClr val="800080"/></a:folHlink>'
        '</a:clrScheme>'
        '<a:fontScheme name="Office">'
        '<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
        '</a:fontScheme>'
        '<a:fmtScheme name="Office">'
        '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
        '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
        '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
        '</a:fmtScheme>'
        '</a:themeElements></a:theme>'
    )


def slide_xml(image_rel_id: str):
    return xml_declaration(
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        '<p:pic>'
        '<p:nvPicPr>'
        '<p:cNvPr id="2" name="slide image"/>'
        '<p:cNvPicPr/>'
        '<p:nvPr/>'
        '</p:nvPicPr>'
        '<p:blipFill>'
        f'<a:blip r:embed="{image_rel_id}"/>'
        '<a:stretch><a:fillRect/></a:stretch>'
        '</p:blipFill>'
        '<p:spPr>'
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{int(SLIDE_W)}" cy="{int(SLIDE_H)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        '</p:spPr>'
        '</p:pic>'
        '</p:spTree></p:cSld>'
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
        '</p:sld>'
    )


def build_pptx(image_paths, out_path):
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', content_types_xml(len(image_paths)))
        zf.writestr('_rels/.rels', rels_xml([
            ('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'ppt/presentation.xml'),
        ]))

        pres_rels = [
            ('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', 'slideMasters/slideMaster1.xml'),
        ]
        for i in range(1, len(image_paths) + 1):
            pres_rels.append(
                (f'rId{i+1}', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', f'slides/slide{i}.xml')
            )
        zf.writestr('ppt/_rels/presentation.xml.rels', rels_xml(pres_rels))
        zf.writestr('ppt/presentation.xml', presentation_xml(len(image_paths)))

        zf.writestr('ppt/slideMasters/slideMaster1.xml', slide_master_xml())
        zf.writestr('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels_xml([
            ('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml'),
            ('rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', '../theme/theme1.xml'),
        ]))
        zf.writestr('ppt/slideLayouts/slideLayout1.xml', slide_layout_xml())
        zf.writestr('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels_xml([]))
        zf.writestr('ppt/theme/theme1.xml', theme_xml())

        for idx, image_path in enumerate(image_paths, start=1):
            image_name = f'image{idx}.png'
            zf.write(image_path, f'ppt/media/{image_name}')
            zf.writestr(f'ppt/slides/slide{idx}.xml', slide_xml('rId2'))
            zf.writestr(
                f'ppt/slides/_rels/slide{idx}.xml.rels',
                rels_xml([
                    ('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml'),
                    ('rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', f'../media/{image_name}'),
                ])
            )


def main():
    if len(sys.argv) < 3:
        print('Usage: build_costing_ppt.py OUTPUT.pptx IMAGE1 [IMAGE2 ...]')
        return 2

    out_path = sys.argv[1]
    image_paths = sys.argv[2:]
    build_pptx(image_paths, out_path)
    print(out_path)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
