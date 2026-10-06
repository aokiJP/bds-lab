// gpdl: an app the account owns, from Google Play, into a folder. Says what Play answered at every step.
//   gpdl -i <ini with [google] email / aas_token> -d <device> [--device-file <properties>] -a <package> [--accept-tos] [--locale ja_JP] <out dir>
//   gpdl ... -a <package> --details-only     only what Play offers now: VERSION <code> <name> (no download; no out dir)
// - --device-file: the device profile from that file instead of rs-google-play's list (bds-lab's bdslab_x86_64, which
//   build.sh writes beside gpdl: Play then sends the x86_64 build of an app that has one)
// - the credentials come only from the ini (never argv, never printed)
// - a paid app is never "purchased": only the delivery of what the account already owns is asked for
// - every line it prints starts with a word the lab reads: STEP / INFO / SAVED / FAIL <kind>
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::exit;

use configparser::ini::Ini;
use futures::StreamExt;
use gpapi::error::ErrorKind;
use gpapi::Gpapi;
use googleplay_protobuf::{AndroidAppDeliveryData, ResponseWrapper};
use tokio::io::AsyncWriteExt;

fn fail(kind: &str, msg: impl AsRef<str>) -> ! {
    println!("FAIL {} {}", kind, msg.as_ref().replace('\n', " "));
    exit(match kind { "usage" => 2, "auth" | "tos" => 3, "refused" => 4, _ => 1 });
}

struct Args { ini: String, device: String, device_file: Option<String>, pkg: String, out: PathBuf, accept_tos: bool, locale: String, details_only: bool }

fn args() -> Args {
    let mut a = std::env::args().skip(1);
    let (mut ini, mut device, mut device_file, mut pkg, mut out, mut accept_tos, mut locale, mut details_only) = (None, String::from("px_9a"), None, None, None, false, String::from("ja_JP"), false);
    while let Some(x) = a.next() {
        match x.as_str() {
            "-i" => ini = a.next(),
            "-d" => device = a.next().unwrap_or_default(),
            "--device-file" => device_file = a.next(),
            "-a" => pkg = a.next(),
            "--accept-tos" => accept_tos = true,
            "--details-only" => details_only = true,
            "--locale" => locale = a.next().unwrap_or_default(),
            _ if !x.starts_with('-') => out = Some(PathBuf::from(x)),
            _ => fail("usage", format!("unknown option {}", x)),
        }
    }
    if details_only && out.is_none() { out = Some(PathBuf::from(".")); }
    match (ini, pkg, out) {
        (Some(ini), Some(pkg), Some(out)) => Args { ini, device, device_file, pkg, out, accept_tos, locale, details_only },
        _ => fail("usage", "gpdl -i <ini> -d <device> [--device-file <properties>] -a <package> [--accept-tos] [--locale ja_JP] [--details-only] <out dir>"),
    }
}

/// what the server said besides the payload (Play puts its refusals here)
fn server_says(r: &ResponseWrapper) -> String {
    r.commands.as_ref().and_then(|c| c.display_error_message.clone()).unwrap_or_default()
}

async fn delivery(gpa: &Gpapi, pkg: &str, vc: i64, ot: i32, dtok: Option<&str>) -> Result<(Option<i32>, Option<AndroidAppDeliveryData>, String), String> {
    let mut q = HashMap::new();
    q.insert("ot", ot.to_string());
    q.insert("doc", pkg.to_string());
    q.insert("vc", vc.to_string());
    if let Some(t) = dtok { q.insert("dtok", t.to_string()); }
    let h = gpa.get_default_headers().map_err(|e| e.to_string())?;
    let r = gpa.execute_request("delivery", Some(q), None, h).await.map_err(|e| e.to_string())?;
    let said = server_says(&r);
    let d = r.payload.and_then(|p| p.delivery_response);
    Ok((d.as_ref().and_then(|d| d.status), d.and_then(|d| d.app_delivery_data), said))
}

async fn save(client: &reqwest::Client, url: &str, cookies: &str, dir: &Path, name: &str) -> Result<u64, String> {
    let mut req = client.get(url);
    if !cookies.is_empty() { req = req.header("Cookie", cookies); }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() { return Err(format!("HTTP {}", res.status())); }
    let part = dir.join(format!("{}.part", name));
    let mut f = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let mut n = 0u64;
    let mut s = res.bytes_stream();
    while let Some(chunk) = s.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        n += chunk.len() as u64;
        f.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    f.flush().await.map_err(|e| e.to_string())?;
    drop(f);
    tokio::fs::rename(&part, dir.join(name)).await.map_err(|e| e.to_string())?;
    Ok(n)
}

#[tokio::main]
async fn main() {
    let a = args();
    let mut ini = Ini::new();
    if let Err(e) = ini.load(&a.ini) { fail("usage", format!("ini: {}", e)); }
    let (email, aas) = match (ini.get("google", "email"), ini.get("google", "aas_token")) {
        (Some(e), Some(t)) if !e.is_empty() && !t.is_empty() => (e, t),
        _ => fail("usage", "ini needs [google] email and aas_token"),
    };
    if !Path::new(&a.out).is_dir() { fail("usage", "out dir does not exist"); }

    println!("STEP login device={} locale={}", a.device, a.locale);
    let mut gpa = match &a.device_file {
        // (gpapi panics on a file or a name it cannot find: both are looked at first)
        Some(f) => {
            let text = std::fs::read_to_string(f).unwrap_or_else(|e| fail("usage", format!("device file {}: {}", f, e)));
            if !text.lines().any(|l| l.trim().eq_ignore_ascii_case(&format!("[{}]", a.device))) { fail("usage", format!("device {} is not in {}", a.device, f)); }
            Gpapi::from_device_properties_file(a.device.as_str(), email.as_str(), f.as_str())
        }
        None => Gpapi::new(a.device.as_str(), email.as_str()),
    };
    gpa.set_locale(a.locale.as_str());
    gpa.set_aas_token(aas.as_str());
    if let Err(e) = gpa.login().await {
        if matches!(e.kind(), ErrorKind::TermsOfService) {
            if !a.accept_tos { fail("tos", "the account has not accepted the Google Play terms (pass --accept-tos)"); }
            if let Err(e) = gpa.accept_tos().await { fail("tos", format!("could not accept the terms: {}", e)); }
            println!("INFO terms accepted");
            if let Err(e) = gpa.login().await { fail("auth", format!("login after accepting the terms: {}", e)); }
        } else {
            fail("auth", format!("login: {}", e));
        }
    }

    println!("STEP details {}", a.pkg);
    let details = match gpa.details(a.pkg.as_str()).await {
        Ok(Some(d)) => d,
        Ok(None) => fail("refused", "details: empty answer (the app is not visible to this account/device/country)"),
        Err(e) => fail("refused", format!("details: {}", e)),
    };
    let item = details.item.unwrap_or_default();
    let app = item.details.clone().and_then(|d| d.app_details).unwrap_or_default();
    let vc = app.version_code.unwrap_or_else(|| fail("refused", "details: no version code (not offered for this device)"));
    let offer = item.offer.first().cloned().unwrap_or_default();
    let paid = offer.micros.unwrap_or(0) > 0;
    let ot = offer.offer_type.unwrap_or(1);
    let vname = app.version_string.clone().unwrap_or_default();
    println!("INFO title={:?} version={} code={} price={:?} paid={} offer_type={}",
        item.title.unwrap_or_default(), vname, vc, offer.formatted_amount.unwrap_or_default(), paid, ot);
    if a.details_only { println!("VERSION {} {}", vc, vname); return; }

    // paid: only the delivery of what is owned (no purchase call). free: purchase (= "get") gives the delivery token
    let mut tries: Vec<(i32, Option<String>)> = Vec::new();
    if paid {
        tries.push((ot, None));
        if ot != 1 { tries.push((1, None)); }
    } else {
        println!("STEP purchase (free app)");
        let mut q = HashMap::new();
        q.insert("ot", ot.to_string());
        q.insert("doc", a.pkg.clone());
        q.insert("vc", vc.to_string());
        let mut h = gpa.get_default_headers().unwrap_or_default();
        h.insert("content-length", String::from("0"));
        match gpa.execute_request("purchase", Some(q), Some(&[]), h).await {
            Ok(r) => {
                let said = server_says(&r);
                let br = r.payload.and_then(|p| p.buy_response);
                let tok = br.as_ref().and_then(|b| b.encoded_delivery_token.clone());
                let st = br.as_ref().and_then(|b| b.purchase_status_response.as_ref()).map(|s| format!("{:?} {:?}", s.status, s.status_msg)).unwrap_or_default();
                println!("INFO purchase token={} status={} server={:?}", tok.is_some(), st, said);
                tries.push((ot, tok));
            }
            Err(e) => { println!("INFO purchase failed: {}", e); tries.push((ot, None)); }
        }
    }

    let mut got = None;
    let mut why = Vec::new();
    for (ot, tok) in &tries {
        println!("STEP delivery ot={} token={}", ot, tok.is_some());
        match delivery(&gpa, &a.pkg, vc, *ot, tok.as_deref()).await {
            Ok((st, Some(d), _)) if d.download_url.is_some() => { println!("INFO delivery status={:?}", st); got = Some(d); break; }
            Ok((st, _, said)) => {
                // DeliveryResponse.status: 1 ok, 2 not supported, 3 not purchased, 4 revoked, 5 forward-locked
                let m = match st { Some(2) => "not supported on this device", Some(3) => "not purchased by this account", Some(4) => "purchase revoked", Some(5) => "forward locked", _ => "no download link" };
                println!("INFO delivery status={:?} ({}) server={:?}", st, m, said);
                why.push(format!("ot={} status={:?} {}{}", ot, st, m, if said.is_empty() { String::new() } else { format!(" / {}", said) }));
            }
            Err(e) => { println!("INFO delivery error: {}", e); why.push(format!("ot={} {}", ot, e)); }
        }
    }
    let d = got.unwrap_or_else(|| fail("refused", format!("delivery: {}", why.join("; "))));

    let cookies = d.download_auth_cookie.iter().map(|c| format!("{}={}", c.name.clone().unwrap_or_default(), c.value.clone().unwrap_or_default())).collect::<Vec<_>>().join("; ");
    let dir = a.out.join(&a.pkg);
    if let Err(e) = std::fs::create_dir_all(&dir) { fail("io", e.to_string()); }
    let client = reqwest::Client::new();
    let mut files = vec![(format!("{}.apk", a.pkg), d.download_url.clone().unwrap())];
    for s in &d.split_delivery_data {
        if let (Some(n), Some(u)) = (&s.name, &s.download_url) { files.push((format!("{}.{}.apk", a.pkg, n), u.clone())); }
    }
    println!("STEP download {} files", files.len());
    for (name, url) in files {
        match save(&client, &url, &cookies, &dir, &name).await {
            Ok(n) => println!("SAVED {} {}", name, n),
            Err(e) => fail("download", format!("{}: {}", name, e)),
        }
    }
}
