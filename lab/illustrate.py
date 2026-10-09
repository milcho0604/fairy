# 실험: 펫 사진을 무료 Hugging Face 그림 편집 모델로 "혼자, 몸 전체, 정면" 일러스트로 다시 그려 본다.
# GitHub Actions 에서 돈다 (lab-illustrate.yml). 결과 그림과 기록은 lab/out 에 남긴다. 앱 코드가 아니다.
import json
import os
import shutil
import traceback

from gradio_client import Client, handle_file

SPACES = [
    "black-forest-labs/FLUX.1-Kontext-Dev",
    "multimodalart/Qwen-Image-Edit-Fast",
    "Qwen/Qwen-Image-Edit",
]
STYLE = (
    "Keep its identity: same breed, fur color, fur texture, face markings and eye color. Show the WHOLE body, "
    "facing the viewer, all paws visible, centered, alone (no other animals, no box, no props), "
    "cute polished realistic 3D illustration like a premium app character, plain light solid background, "
    "soft studio light, no text, no watermark."
)
AGES = {
    "baby": "as a tiny baby (a few weeks old): very small and round, oversized head, big eyes, short stubby legs, extra soft fluffy baby coat, sitting",
    "teen": "as a playful adolescent (about five months old): slimmer, slightly long legs and big paws, standing",
    "adult": "as a fully grown adult in its prime: full size, confident, well-groomed coat, standing",
}
PETS = [
    ("poodle", "lab/in_poodle.png", "Redraw this curly brown poodle"),
    ("cat", "lab/in_cat.png", "Redraw this fluffy white long-haired cat with amber eyes"),
]
JOBS = [(f"{pet}-{age}", path, f"{who} {AGES[age]}. {STYLE}") for pet, path, who in PETS for age in AGES]
os.makedirs("lab/out", exist_ok=True)
log = []


def build_args(params, image_path, prompt):
    args = {}
    for p in params:
        name = (p.get("parameter_name") or "").lower()
        comp = (p.get("component") or "").lower()
        if comp == "gallery" or (name.startswith("image") and "gallery" in comp):
            args[p["parameter_name"]] = [{"image": handle_file(image_path), "caption": None}]
        elif comp == "image" or name in ("image", "input_image", "img", "images"):
            args[p["parameter_name"]] = handle_file(image_path)
        elif "prompt" in name and "negative" not in name:
            args[p["parameter_name"]] = prompt
        elif not p.get("parameter_has_default"):
            return None
    return args


def first_image(result):
    if isinstance(result, str) and os.path.isfile(result):
        return result
    if isinstance(result, dict):
        for k in ("path", "image", "value", "url"):
            if k in result:
                found = first_image(result[k])
                if found:
                    return found
    if isinstance(result, (list, tuple)):
        for r in result:
            found = first_image(r)
            if found:
                return found
    return None


done = set()
for space in SPACES:
    if len(done) == len(JOBS):
        break
    entry = {"space": space}
    try:
        client = Client(space)
        api = client.view_api(return_format="dict", print_info=False)
        entry["endpoints"] = {k: [(p.get("parameter_name"), p.get("component")) for p in v.get("parameters", [])]
                              for k, v in api.get("named_endpoints", {}).items()}
    except Exception as e:  # noqa: BLE001
        entry["error"] = f"connect: {e}"
        log.append(entry)
        continue
    for name, path, prompt in JOBS:
        if name in done:
            continue
        for ep, spec in api.get("named_endpoints", {}).items():
            args = build_args(spec.get("parameters", []), path, prompt)
            if not args or not any(isinstance(v, (dict, list)) for v in args.values()):
                continue
            try:
                result = client.predict(api_name=ep, **args)
                img = first_image(result)
                entry.setdefault("runs", []).append({"job": name, "endpoint": ep, "result": str(result)[:300], "image": img})
                if img:
                    out = f"lab/out/{name}--{space.replace('/', '_')}{os.path.splitext(img)[1] or '.png'}"
                    shutil.copy(img, out)
                    done.add(name)
                    break
            except Exception as e:  # noqa: BLE001
                entry.setdefault("runs", []).append({"job": name, "endpoint": ep, "error": traceback.format_exc()[-800:]})
    log.append(entry)

with open("lab/out/log.json", "w") as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
print(json.dumps(log, ensure_ascii=False, indent=2)[:6000])
