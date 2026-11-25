//! EPUB: giải nén trong RAM, không bao giờ ghi file ra đĩa.
//! Chỉ dùng parser chuỗi đơn giản (container.xml + content.opf + toc.ncx)
//! để tránh thêm dependency XML nặng cho scaffold đầu tiên.

use serde::Serialize;
use std::fs::File;
use std::io::Read;
use zip::ZipArchive;

#[derive(Debug, Serialize, Clone)]
pub struct Chapter {
    pub title: String,
    pub href: String,
}

fn read_zip_entry(path: &str, name: &str) -> Result<Vec<u8>, String> {
    let f = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn attr(text: &str, name: &str) -> Option<String> {
    // Tìm name="..." trong 1 thẻ XML (đủ dùng cho opf/ncx của EPUB thật).
    let pat = format!("{}=\"", name);
    let i = text.find(&pat)? + pat.len();
    let j = text[i..].find('"')?;
    Some(text[i..i + j].to_string())
}

fn text_between(text: &str, open: &str, close: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find(open) {
        let start = i + open.len();
        let Some(j) = rest[start..].find(close) else {
            break;
        };
        out.push(rest[start..start + j].trim().to_string());
        rest = &rest[start + j + close.len()..];
    }
    out
}

pub fn toc(path: &str) -> Result<Vec<Chapter>, String> {
    let container = String::from_utf8_lossy(&read_zip_entry(path, "META-INF/container.xml")?).into_owned();
    let opf_path = attr(&container, "full-path").unwrap_or_else(|| "OEBPS/content.opf".to_string());
    let base = opf_path.rsplit_once('/').map(|(b, _)| b.to_string()).unwrap_or_default();
    let opf = String::from_utf8_lossy(&read_zip_entry(path, &opf_path)?).into_owned();

    // Ưu tiên toc.ncx (mục lục chuẩn), fallback: danh sách spine trong opf.
    let mut chapters: Vec<Chapter> = Vec::new();
    if let Some(ncx) = opf
        .split("media-type=\"application/x-dtbncx+xml\"")
        .nth(1)
        .and_then(|s| attr(s, "href"))
    {
        let ncx_path = if base.is_empty() { ncx.clone() } else { format!("{}/{}", base, ncx) };
        if let Ok(ncx_bytes) = read_zip_entry(path, &ncx_path) {
            let ncx_text = String::from_utf8_lossy(&ncx_bytes).into_owned();
            let labels = text_between(&ncx_text, "<text>", "</text>");
            let hrefs: Vec<String> = ncx_text
                .split("<content")
                .skip(1)
                .filter_map(|s| attr(s, "src"))
                .collect();
            for (i, href) in hrefs.iter().enumerate() {
                let clean = href.split('#').next().unwrap_or(href).to_string();
                chapters.push(Chapter {
                    title: labels.get(i).cloned().unwrap_or_else(|| format!("Chương {}", i + 1)),
                    href: if base.is_empty() { clean } else { format!("{}/{}", base, clean) },
                });
            }
            if !chapters.is_empty() {
                return Ok(chapters);
            }
        }
    }

    // Fallback: manifest + spine.
    let manifest: Vec<(String, String)> = opf
        .split("<item ")
        .skip(1)
        .filter_map(|s| {
            let id = attr(s, "id")?;
            let href = attr(s, "href")?;
            Some((id, href))
        })
        .collect();
    let spine: Vec<String> = opf
        .split("<itemref ")
        .skip(1)
        .filter_map(|s| attr(s, "idref"))
        .collect();
    for (i, idref) in spine.iter().enumerate() {
        if let Some((_, href)) = manifest.iter().find(|(id, _)| id == idref) {
            let clean = href.split('#').next().unwrap_or(href).to_string();
            chapters.push(Chapter {
                title: format!("Chương {}", i + 1),
                href: if base.is_empty() { clean } else { format!("{}/{}", base, clean) },
            });
        }
    }
    Ok(chapters)
}

pub fn chapter_html(path: &str, href: &str) -> Result<String, String> {
    let bytes = read_zip_entry(path, href)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
