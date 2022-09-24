# Qraffle

*Qraffle* is a custom implementation of on-chain raffle program. It is partially based on [Draffle](https://github.com/draffle-io/draffle)

# Requirements

1. Node v16.17.0
2. Yarn v1.22.19
3. Rust 1.63.0
4. Anchor v0.24.2

# Installation

1. Run `yarn`
2. Run `anchor build`
3. Update the generated program address in `programs/qraffle/lib.rs` and `Anchor.toml`
4. Re-build using `anchor build`
5. Deploy on-chain using `solana program deploy target/deploy/qraffle.so`
6. (Optional) Test using `anchor test --skip-local-validator --skip-deploy --skip-build`


