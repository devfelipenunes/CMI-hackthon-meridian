use std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, multi_scalar_mul};

pub global TOKEN_G: EmbeddedCurvePoint = EmbeddedCurvePoint {
    x: 0x083e7911d835097629f0067531fc15cafd79a89beecb39903f69572c636f4a5a,
    y: 0x1a7f5efaad7f315c25a918f30cc8d7333fccab7ad7c90f14de81bcc528f9935d,
    is_infinite: false,
};
pub global TOKEN_H: EmbeddedCurvePoint = EmbeddedCurvePoint {
    x: 0x054aa86a73cb8a34525e5bbed6e43ba1198e860f5f3950268f71df4591bde402,
    y: 0x209dcfbf2cfb57f9f6046f44d71ac6faf87254afc7407c04eb621a6287cac126,
    is_infinite: false,
};

pub fn commit(value: Field, randomness: Field) -> EmbeddedCurvePoint {
    multi_scalar_mul(
        [TOKEN_G, TOKEN_H],
        [EmbeddedCurveScalar::from_field(value), EmbeddedCurveScalar::from_field(randomness)],
    )
}

#[test]
fn commit_uses_token_generators() {
    let c = commit(650 * 200, 424242424242);
    assert(c.x == 0x0e91b114cb2600d4488d21bf6f14dd37eb2241d43ee29e9e22dcd55647755e2e);
    assert(c.y == 0x28063c5bb9133713fd01b62af2f12561308b27b0665fa585571d04b58a09385d);
}
