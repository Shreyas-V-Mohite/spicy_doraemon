"""
Static INT8 (QDQ) quantization of the RTMPose-m hand model for faster CPU/WASM
inference. Weights per-channel int8, activations uint8, calibrated on real
hand crops produced by dump-calibration.ts.

    pip install onnx onnxruntime
    python scripts/quantize/quantize_pose.py <calibDir> <in.onnx> <out.onnx>

Validate afterwards with:  npm run test:inference  (uses whichever pose model
is in public/models) and the PCK threshold there.
"""
import glob
import os
import sys

import numpy as np
import onnx
from onnx import version_converter
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
from onnxruntime.quantization.shape_inference import quant_pre_process

calib_dir, src, dst = sys.argv[1:4]


class HandCrops(CalibrationDataReader):
    def __init__(self, files, input_name):
        self.files = iter(files)
        self.input_name = input_name

    def get_next(self):
        f = next(self.files, None)
        if f is None:
            return None
        x = np.fromfile(f, dtype=np.float32).reshape(1, 3, 256, 256)
        return {self.input_name: x}


pre = dst + ".pre.onnx"
# The mmdeploy export is opset 11; per-channel QDQ needs opset >= 13.
opset13 = dst + ".opset13.onnx"
onnx.save(version_converter.convert_version(onnx.load(src), 13), opset13)
quant_pre_process(opset13, pre, skip_symbolic_shape=True)
os.remove(opset13)
files = sorted(glob.glob(os.path.join(calib_dir, "calib_*.bin")))
quantize_static(
    pre,
    dst,
    HandCrops(files, "input"),
    quant_format=QuantFormat.QDQ,
    per_channel=True,
    weight_type=QuantType.QInt8,
    activation_type=QuantType.QUInt8,
    # Keep the SimCC classification heads in float: they decide keypoint
    # positions bin-by-bin and are a tiny share of the compute.
    nodes_to_exclude=[],
    extra_options={"ActivationSymmetric": False, "WeightSymmetric": True},
)
os.remove(pre)
print(f"calibrated on {len(files)} crops -> {dst} ({os.path.getsize(dst) / 1e6:.1f} MB)")
