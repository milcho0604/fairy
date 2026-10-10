# 털 다듬기 요청문 비교 (klein 4B). 같은 Kontext 그림 3장에 요청문 하나씩
import json, os, shutil, sys, traceback
from gradio_client import Client, handle_file
v = int(sys.argv[1])
BASE_KEEP = ("Keep everything else exactly the same: same pose, face, eyes, markings, lighting and plain background.")
PROMPTS = [
    # 0: 지금 앱
    ("Make the fur on the legs, paws, chest and tail longer, thicker and fluffier: long soft fluffy feathering on all four legs, "
     "fluffy britches on the hind legs and fluffy tufts on the paws, as fluffy as the rest of the coat. "
     "Keep the same fur color and fur type (curly fur stays curly). " + BASE_KEEP),
    # 1: 색과 결을 못박는다
    ("Make the fur on the legs, paws, chest and tail longer, thicker and fluffier, like freshly brushed, blow-dried show fur: "
     "soft, clean, airy and voluminous (not wet, not stringy, not matted, not greasy). Long fluffy feathering on all four legs, "
     "fluffy britches on the hind legs, fluffy tufts on the paws, as fluffy as the chest. "
     "Keep the exact same fur color and brightness (white stays bright pure white, brown stays the same brown) and the same fur type: "
     "curly fur stays tightly curly everywhere, straight fur stays straight. " + BASE_KEEP),
    # 2: 1 보다 짧게 (요청이 길면 다른 곳까지 바뀐다)
    ("Only make the fur on the legs and paws fluffier and longer, soft clean and airy like brushed show fur, matching the fluffy chest. "
     "Same fur color and brightness, same fur type (curls stay curly). Do not change anything else."),
    # 3: 1 에서 색 예시를 뺀다 (흰색을 말하자 갈색 푸들이 하얘졌다)
    ("Make the fur on the legs, paws, chest and tail longer, thicker and fluffier, like freshly brushed, blow-dried show fur: "
     "soft, clean, airy and voluminous (not wet, not stringy, not matted). Long fluffy feathering on all four legs, "
     "fluffy britches on the hind legs, fluffy tufts on the paws, as fluffy as the chest. "
     "Keep the exact same fur colors and brightness as in this image: do not recolor, tint, darken or gray the fur. "
     "Keep the same fur type: curly fur stays curly, straight fur stays straight. " + BASE_KEEP),
    # 4: 2 를 다리 쪽으로 더 세게
    ("Only make the fur on all four legs and paws much fluffier and longer: long soft feathering down the legs, fluffy britches, "
     "fluffy tufts on the paws, soft clean and airy like brushed show fur, as fluffy as the chest. "
     "Same fur colors and brightness, same fur type (curls stay curly). Do not change anything else."),
]
os.makedirs(f"lab/out-fur5/v{v}", exist_ok=True)
log = []
c = Client("black-forest-labs/FLUX.2-klein-4B")
for n in ["cat-adult", "cat-teen", "poodle-teen"]:
    try:
        r = c.predict(prompt=PROMPTS[v], input_images=[{"image": handle_file(f"lab/out-fur3/v0/{n}.webp"), "caption": None}],
                      mode_choice="Distilled (4 steps)", seed=0, randomize_seed=True, width=608, height=1024,
                      num_inference_steps=4, guidance_scale=1.0, prompt_upsampling=False, api_name="/infer")
        p = r[0] if isinstance(r, (list, tuple)) else r
        p = p.get("path") if isinstance(p, dict) else p
        shutil.copy(p, f"lab/out-fur5/v{v}/{n}{os.path.splitext(p)[1] or '.png'}")
        log.append({"job": n, "ok": True})
    except Exception:
        log.append({"job": n, "ok": False, "error": traceback.format_exc()[-600:]})
json.dump({"prompt": PROMPTS[v], "log": log}, open(f"lab/out-fur5/v{v}/log.json", "w"), indent=1)
print(json.dumps(log, indent=1))
