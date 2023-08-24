import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmm2023, IDL } from "../target/types/anchor_amm_2023";
import { ConstantProduct, LiquidityPair } from "constant-product-curve-wasm";
import {
  PublicKey,
  Commitment,
  Keypair,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as associatedTokenProgram,
  TOKEN_PROGRAM_ID as tokenProgram,
  createMint,
  createAccount,
  mintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  getAccount,
  Account as TokenAccount,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { assert } from "chai";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

const commitment: Commitment = "confirmed"; // processed, confirmed, finalized
const DECIMALS = 6;

describe("anchor-amm-2023", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const connection = anchor.getProvider().connection;

  const programId = new PublicKey(
    "GiVFHELhmrVa7sMGZUcG52M3rfqzPXNsZ9AokuKD8Tmy"
  );
  const program = new anchor.Program<AnchorAmm2023>(
    IDL,
    programId,
    anchor.getProvider()
  );

  // Set up our keys
  const [initializer, user] = [new Keypair(), new Keypair()];

  // Random seed
  const seed = new BN(randomBytes(8));

  // PDAs
  const auth = PublicKey.findProgramAddressSync(
    [Buffer.from("auth")],
    program.programId
  )[0];
  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), seed.toBuffer().reverse()],
    program.programId
  )[0];

  // Mints
  let mint_x: PublicKey;
  let mint_y: PublicKey;
  let mint_lp = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), config.toBuffer()],
    program.programId
  )[0];

  // ATAs
  let initializer_x_ata: PublicKey;
  let initializer_y_ata: PublicKey;
  let initializer_lp_ata: PublicKey;
  let user_x_ata: PublicKey;
  let user_y_ata: PublicKey;
  let user_lp_ata: PublicKey;
  let vault_x_ata: PublicKey;
  let vault_y_ata: PublicKey;
  let vault_lp_ata: PublicKey;

  it("Airdrop", async () => {
    await Promise.all(
      [initializer, user].map(async (k) => {
        return await anchor
          .getProvider()
          .connection.requestAirdrop(
            k.publicKey,
            100 * anchor.web3.LAMPORTS_PER_SOL
          );
      })
    ).then(confirmTxs);
  });

  it("Create mints, tokens and ATAs", async () => {
    // Create mints and ATAs
    let [u1, u2] = await Promise.all(
      [initializer, initializer].map(async (a) => {
        return await newMintToAta(anchor.getProvider().connection, a);
      })
    );
    mint_x = u1.mint;
    mint_y = u2.mint;
    initializer_x_ata = u1.ata;
    initializer_y_ata = u2.ata;
    initializer_lp_ata = await getAssociatedTokenAddress(
      mint_lp,
      initializer.publicKey,
      false,
      tokenProgram
    );
    // Create take ATAs
    vault_x_ata = await getAssociatedTokenAddress(
      mint_x,
      auth,
      true,
      tokenProgram
    );
    vault_y_ata = await getAssociatedTokenAddress(
      mint_y,
      auth,
      true,
      tokenProgram
    );
    vault_lp_ata = await getAssociatedTokenAddress(
      mint_lp,
      auth,
      true,
      tokenProgram
    );
    user_x_ata = await mintToAta(connection, initializer, user, mint_x);
    user_y_ata = await mintToAta(connection, initializer, user, mint_y);
    user_lp_ata = await getAssociatedTokenAddress(
      mint_lp,
      user.publicKey,
      false,
      tokenProgram
    );
  });

  // // let c = new ConstantProduct(BigInt(30), BigInt(20), BigInt(20), 20);
  // // let res = c.swap(LiquidityPair.X, BigInt(1000), BigInt(200));

  it("Initialize", async () => {
    try {
      const tx = await program.methods
        .initialize(seed, 0, initializer.publicKey)
        .accounts({
          auth,
          initializer: initializer.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          mintLp: mint_lp,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      console.log("Your transaction signature", tx);
    } catch (e) {
      console.error(e);
    }
  });

  it("Lock", async () => {
    try {
      const tx = await program.methods
        .lock()
        .accounts({
          user: initializer.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Unlock", async () => {
    try {
      const tx = await program.methods
        .unlock()
        .accounts({
          user: initializer.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Fail to lock", async () => {
    try {
      const tx = await program.methods
        .lock()
        .accounts({
          user: user.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Fail to unlock", async () => {
    try {
      const tx = await program.methods
        .unlock()
        .accounts({
          user: user.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Deposit 1st", async () => {
    try {
      const vaultXBefore = await getAccount(
        connection,
        vault_x_ata,
        commitment
      );
      const vaultYBefore = await getAccount(
        connection,
        vault_y_ata,
        commitment
      );
      const tx = await program.methods
        .deposit(
          new BN(20 * 10 ** DECIMALS),
          new BN(20 * 10 ** DECIMALS),
          new BN(30 * 10 ** DECIMALS),
          new BN(Math.floor(new Date().getTime() / 1000) + 600)
        )
        .accountsStrict({
          auth,
          user: initializer.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          mintLp: mint_lp,
          userX: initializer_x_ata,
          userY: initializer_y_ata,
          userLp: initializer_lp_ata,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      await balanceChange(connection, vaultXBefore, vaultYBefore);
      console.log("Your deposit transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      console.error(e);
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Deposit 2nd", async () => {
    try {
      const vaultXBefore = await getAccount(
        connection,
        vault_x_ata,
        commitment
      );
      const vaultYBefore = await getAccount(
        connection,
        vault_y_ata,
        commitment
      );
      const tx = await program.methods
        .deposit(
          new BN(10 * 10 ** DECIMALS),
          new BN(10 * 10 ** DECIMALS),
          new BN(15 * 10 ** DECIMALS),
          new BN(Math.floor(new Date().getTime() / 1000) + 600)
        )
        .accountsStrict({
          auth,
          user: user.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          mintLp: mint_lp,
          userX: user_x_ata,
          userY: user_y_ata,
          userLp: user_lp_ata,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      await confirmTx(tx);
      await balanceChange(connection, vaultXBefore, vaultYBefore);
      console.log("Your deposit transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      console.error(e);
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Swap X for Y", async () => {
    try {
      const vaultXBefore = await getAccount(
        connection,
        vault_x_ata,
        commitment
      );
      const vaultYBefore = await getAccount(
        connection,
        vault_y_ata,
        commitment
      );
      const tx = await program.methods
        .swap(
          true,
          new BN(15 * 10 ** DECIMALS),
          new BN(15 * 10 ** DECIMALS),
          new BN(Math.floor(new Date().getTime() / 1000) + 600)
        )
        .accountsStrict({
          auth,
          user: initializer.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          userX: initializer_x_ata,
          userY: initializer_y_ata,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      await balanceChange(connection, vaultXBefore, vaultYBefore);
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      console.error(e);
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Swap Y for X", async () => {
    try {
      const vaultXBefore = await getAccount(
        connection,
        vault_x_ata,
        commitment
      );
      const vaultYBefore = await getAccount(
        connection,
        vault_y_ata,
        commitment
      );
      const tx = await program.methods
        .swap(
          false,
          new BN(30 * 10 ** DECIMALS),
          new BN(7.5 * 10 ** DECIMALS),
          new BN(Math.floor(new Date().getTime() / 1000) + 600)
        )
        .accountsStrict({
          auth,
          user: initializer.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          userX: initializer_x_ata,
          userY: initializer_y_ata,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      await balanceChange(connection, vaultXBefore, vaultYBefore);
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      console.error(e);
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });

  it("Withdraw", async () => {
    try {
      const vaultXBefore = await getAccount(
        connection,
        vault_x_ata,
        commitment
      );
      const vaultYBefore = await getAccount(
        connection,
        vault_y_ata,
        commitment
      );
      const tx = await program.methods
        .withdraw(
          new BN(20 * 10 ** DECIMALS),
          new BN(15 * 10 ** DECIMALS),
          new BN(40 * 10 ** DECIMALS),
          new BN(Math.floor(new Date().getTime() / 1000) + 600)
        )
        .accountsStrict({
          auth,
          user: initializer.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          mintLp: mint_lp,
          userX: initializer_x_ata,
          userY: initializer_y_ata,
          userLp: initializer_lp_ata,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();
      await confirmTx(tx);
      await balanceChange(connection, vaultXBefore, vaultYBefore);
      console.log("Your transaction signature", tx);
    } catch (e) {
      let err = e as anchor.AnchorError;
      console.error(e);
      if (err.error.errorCode.code !== "InvalidAuthority") {
        throw e;
      }
    }
  });
});

// Helpers
const confirmTx = async (signature: string) => {
  const latestBlockhash = await anchor
    .getProvider()
    .connection.getLatestBlockhash();
  await anchor.getProvider().connection.confirmTransaction(
    {
      signature,
      ...latestBlockhash,
    },
    commitment
  );
};

const confirmTxs = async (signatures: string[]) => {
  await Promise.all(signatures.map(confirmTx));
};

const newMintToAta = async (
  connection: Connection,
  minter: Keypair
): Promise<{ mint: PublicKey; ata: PublicKey }> => {
  const mint = await createMint(connection, minter, minter.publicKey, null, 6);
  // await getAccount(connection, mint, commitment)
  const ata = await createAccount(connection, minter, mint, minter.publicKey);
  const signature = await mintTo(connection, minter, mint, ata, minter, 21e8);
  await confirmTx(signature);
  return {
    mint,
    ata,
  };
};

const mintToAta = async (
  connection: Connection,
  minter: Keypair,
  receiver: Keypair,
  mint: PublicKey
) => {
  const ata = await createAccount(
    connection,
    receiver,
    mint,
    receiver.publicKey
  );
  const signature = await mintTo(connection, minter, mint, ata, minter, 21e8);
  await confirmTx(signature);
  return ata;
};

const balanceChange = async (
  connection: Connection,
  vaultX: TokenAccount,
  vaultY: TokenAccount
) => {
  const vaultXAfter = await getAccount(connection, vaultX.address, commitment);
  const vaultYAfter = await getAccount(connection, vaultY.address, commitment);
  console.log("\n    Vault Balance");
  console.table({
    before: {
      X: Number(vaultX.amount) / 10 ** 6,
      Y: Number(vaultY.amount) / 10 ** 6,
    },
    after: {
      X: Number(vaultXAfter.amount) / 10 ** 6,
      Y: Number(vaultYAfter.amount) / 10 ** 6,
    },
  });
};
