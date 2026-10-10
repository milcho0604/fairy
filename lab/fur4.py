# 실험 4: (A) Kontext 2차 편집으로 다리 털만 길게, (B) FLUX.2 klein 4B (gradio_client, 갤러리 입력)
import json, os, shutil, sys, traceback
from gradio_client import Client, handle_file

job = sys.argv[1]
os.makedirs("lab/out-fur4", exist_ok=True)
log = []
LEGS = ("Make the fur on all four legs and paws much longer and fluffier: long, soft, fluffy feathering on the legs, "
        "fluffy britches on the hind legs and fluffy tufts on the paws, as fluffy as the chest. "
        "Keep everything else exactly the same: same pose, face, eyes, colors, lighting and plain background.")
FULL = ("A cute, polished, realistic 3D illustration of this exact pet as a fully grown adult, sitting like a real pet, both front paws on the ground, "
        "facing the viewer, whole body visible, alone, centered. Keep the pet's identity: same breed, fur color and pattern, markings and eye color. "
        "Fur: a very long, thick, fluffy coat on every part of the body, the legs are thick fluffy columns of long fur all the way down to the paws, "
        "a big chest ruff and a bushy tail, visible strands and soft wispy edges. No smooth or short-haired areas, especially not on the legs. "
        "It is an animal, never standing upright on its hind legs. Plain light solid background, soft studio light. No text, no watermark.")

def save(name, result):
    def find(r):
        if isinstance(r, str) and os.path.isfile(r): return r
        if isinstance(r, dict):
            for k in ("path", "image", "value"):
                if k in r:
                    f = find(r[k])
                    if f: return f
        if isinstance(r, (list, tuple)):
            for x in r:
                f = find(x)
                if f: return f
    p = find(result)
    if p:
        shutil.copy(p, f"lab/out-fur4/{name}{os.path.splitext(p)[1] or '.png'}")
    return p

def run(name, fn):
    try:
        r = fn()
        log.append({"job": name, "ok": bool(save(name, r)), "result": str(r)[:300]})
    except Exception:
        log.append({"job": name, "ok": False, "error": traceback.format_exc()[-1500:]})

if job == "kontext2":
    c = Client("black-forest-labs/FLUX.1-Kontext-Dev")
    for n in ["cat-adult", "cat-teen"]:
        run(f"k2-{n}", lambda n=n: c.predict(input_image=handle_file(f"lab/out-fur3/v0/{n}.webp"), prompt=LEGS,
                                              seed=0, randomize_seed=True, guidance_scale=2.5, steps=28, api_name="/infer"))
elif job in ("klein", "klein9"):
    c = Client("black-forest-labs/FLUX.2-klein-4B" if job == "klein" else "black-forest-labs/FLUX.2-klein-9B")
    log.append({"api": str(c.view_api(return_format="dict", print_info=False).get("named_endpoints", {}).get("/infer"))[:3000]})
    run(f"{job}-cat-adult", lambda: c.predict(prompt=FULL, input_images=[{"image": handle_file("lab/in_cat.png"), "caption": None}],
                                             mode_choice="Distilled (4 steps)", seed=0, randomize_seed=True, width=608, height=1024,
                                             num_inference_steps=4, guidance_scale=1.0, prompt_upsampling=False, api_name="/infer"))
    run(f"{job}-poodle-adult", lambda: c.predict(prompt=FULL, input_images=[{"image": handle_file("lab/in_poodle.png"), "caption": None}],
                                                mode_choice="Distilled (4 steps)", seed=0, randomize_seed=True, width=608, height=1024,
                                                num_inference_steps=4, guidance_scale=1.0, prompt_upsampling=False, api_name="/infer"))
    run(f"{job}-k2-cat", lambda: c.predict(prompt=LEGS, input_images=[{"image": handle_file("lab/out-fur3/v0/cat-adult.webp"), "caption": None}],
                                          mode_choice="Distilled (4 steps)", seed=0, randomize_seed=True, width=608, height=1024,
                                          num_inference_steps=4, guidance_scale=1.0, prompt_upsampling=False, api_name="/infer"))
json.dump(log, open(f"lab/out-fur4/{job}.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(log, ensure_ascii=False, indent=1)[:5000])
