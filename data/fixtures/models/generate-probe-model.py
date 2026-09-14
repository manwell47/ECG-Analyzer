#!/usr/bin/env python3
"""
Deterministic ONNX seam-probe model generator (Phase 7 item #3).

Builds `ecg-lab-probe-linear-mean-2.onnx` and its matching
`ModelMetadata.json` document. This is a *development seam-validation probe*,
not a scientific model: its only purpose is to exercise the ONNX Runtime Web
path end-to-end (Signal -> ModelInput -> session -> interpret) against a tiny,
fully deterministic graph whose outputs any test can reproduce in JS.

Graph contract (single channel, 360 Hz, one 360-sample window):

    signal   : float32[360]   (graph input; a raw, un-normalized window)
    s1       : ReduceSum(signal, axes=[0], keepdims=1)   -> float32[1]
    n1       : Neg(s1)                                    -> float32[1]
    logits   : Concat([s1, n1], axis=0)                   -> float32[2]

so `logits = [+sum(window), -sum(window)]`; softmax argmax therefore encodes
the *sign of the window mean*:
    sum > 0  -> class 0 "positive-mean"
    sum < 0  -> class 1 "nonpositive-mean"
    sum = 0  -> exact tie (deterministic tie-break to class 0 by declared order)

The output is deliberately raw logits (semantics "logits"); the interpreter's
declared softmax activation performs the conversion to a probability, matching
how `src/ml/interpret.ts` treats `logits` + `activation: "softmax"`.

Re-running this script must regenerate byte-identical artifacts (it uses no
randomness and fixes every producer field and the opset), so the committed
bytes are reproducible from this single source.
"""

from __future__ import annotations

import hashlib
import json
import os

import onnx
from onnx import TensorProto, helper, shape_inference

MODEL_ID = "ecg-lab-probe-linear-mean-2"
MODEL_VERSION = "1.0.0"
PRODUCER_NAME = "ecg-lab-probe-generator"
PRODUCER_VERSION = "1.0.0"
OPSET = 13  # ReduceSum axes become an input at opset 13 (widely supported by ORT).

WINDOW_SAMPLES = 360  # 1.0 s at the laboratory reference 360 Hz.
INPUT_NAME = "signal"
OUTPUT_NAME = "logits"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ONNX_FILE = os.path.join(BASE_DIR, f"{MODEL_ID}.onnx")
METADATA_FILE = os.path.join(BASE_DIR, f"{MODEL_ID}.metadata.json")


def build_graph() -> onnx.ModelProto:
    """Construct the probe graph (pure; deterministic)."""
    # Graph input/output value infos.
    signal_value = helper.make_tensor_value_info(INPUT_NAME, TensorProto.FLOAT, [WINDOW_SAMPLES])
    logits_value = helper.make_tensor_value_info(OUTPUT_NAME, TensorProto.FLOAT, [2])

    # ReduceSum (opset 13+) reads `axes` as its second *input* initializer.
    axes_initializer = helper.make_tensor(
        "reduce_axes", TensorProto.INT64, dims=[1], vals=[0]
    )

    nodes = [
        helper.make_node(
            "ReduceSum",
            inputs=[INPUT_NAME, "reduce_axes"],
            outputs=["window_sum"],
            name="reduce_sum_window",
            keepdims=1,
        ),
        helper.make_node(
            "Neg",
            inputs=["window_sum"],
            outputs=["neg_window_sum"],
            name="negate_window_sum",
        ),
        helper.make_node(
            "Concat",
            inputs=["window_sum", "neg_window_sum"],
            outputs=[OUTPUT_NAME],
            name="concat_logits",
            axis=0,
        ),
    ]

    graph = helper.make_graph(
        nodes,
        name=MODEL_ID,
        inputs=[signal_value],
        outputs=[logits_value],
        initializer=[axes_initializer],
    )

    model = helper.make_model(
        graph,
        producer_name=PRODUCER_NAME,
        producer_version=PRODUCER_VERSION,
        opset_imports=[helper.make_opsetid("", OPSET)],
    )
    model.ir_version = 8  # onnx 1.22 emits ir_version 8; pinned for determinism.
    model.model_version = 1
    model.doc_string = (
        "Phase 7 seam-probe: logits = [+sum(window), -sum(window)] over a "
        "single 360-sample float32 window at 360 Hz. Deterministic development "
        "probe only; never a physiological/clinical classifier."
    )
    return model


def build_metadata_document() -> dict:
    """The exact ModelMetadata.json that ships beside the .onnx (ADR-004 schema)."""
    return {
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "task": "probe-sign-of-mean (development seam-validation; not a physiological classifier)",
        "input": {
            "name": INPUT_NAME,
            "shape": [WINDOW_SAMPLES],
            "dtype": "float32",
            "layout": "samples",
        },
        "expectedSamplingRateHz": 360,
        "expectedChannels": 1,
        "expectedWindowSamples": WINDOW_SAMPLES,
        "preprocessingAssumptions": [
            {
                "stage": "identity-window",
                "config": {
                    "channelCount": 1,
                    "windowSamples": WINDOW_SAMPLES,
                    "sampleRateHz": 360,
                    "note": "Probe consumes the raw prepared window with no filtering, resampling or segmentation.",
                },
            }
        ],
        "normalization": {"strategy": "none"},
        "output": {
            "name": OUTPUT_NAME,
            "dtype": "float32",
            "semantics": "logits",
            "activation": "softmax",
            "classLabels": ["positive-mean", "nonpositive-mean"],
        },
        "provenance": {
            "trainingDataset": "Not trained - synthetic deterministic probe, no data involved",
            "methodology": (
                "One-layer deterministic graph (opset 13): output logits = [+sum, -sum] of the "
                "float32 input window; softmax argmax is the sign of the window mean. Built by "
                f"onnx {onnx.__version__} via {os.path.basename(__file__)}; purpose is to exercise "
                "the ONNX Runtime Web seam end-to-end (Signal -> ModelInput -> session -> interpret). "
                "It is a test oracle, not a scientific model."
            ),
            "limitations": (
                "Development seam-validation probe only. Has no physiological or clinical meaning and "
                "must never be used to inform any medical or scientific conclusion."
            ),
        },
    }


def main() -> None:
    model = build_graph()

    # Structural gate: shape inference + full ONNX checker before serializing.
    inferred = shape_inference.infer_shapes(model)
    onnx.checker.check_model(inferred, full_check=True)

    model_bytes = model.SerializeToString()

    with open(ONNX_FILE, "wb") as handle:
        handle.write(model_bytes)

    document = build_metadata_document()
    with open(METADATA_FILE, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(document, indent=2) + "\n")

    digest = hashlib.sha256(model_bytes).hexdigest()
    print(f"wrote  {ONNX_FILE}")
    print(f"wrote  {METADATA_FILE}")
    print(f"size   {len(model_bytes)} bytes")
    print(f"sha256 {digest}")


if __name__ == "__main__":
    main()
