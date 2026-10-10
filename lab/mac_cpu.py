# 맥 러너는 가상 GPU 라 MLX 가 깨진 그림을 낸다. CPU 로만 돌려 그림 품질을 본다 (느려도 결과는 같은 모델)
import sys, time
import mlx.core as mx
mx.set_default_device(mx.cpu)
from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants import Flux2KleinEdit

src, out, prompt_file = sys.argv[1], sys.argv[2], sys.argv[3]
prompt = open(prompt_file).read().strip()
t = time.time()
model = Flux2KleinEdit(model_config=ModelConfig.flux2_klein_4b(), quantize=8)
print("load", round(time.time() - t), "s", flush=True)
t = time.time()
img = model.generate_image(seed=7, prompt=prompt, image_paths=[src], num_inference_steps=4, width=608, height=1024, guidance=1.0)
img.save(out)
print("gen", round(time.time() - t), "s", flush=True)
