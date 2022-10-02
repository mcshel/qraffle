import assert from 'assert';
import * as spl from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey } from '@solana/web3.js';
import { Qraffle } from '../target/types/qraffle';

describe('Healty raffle lifecycle', async () => {
    const program = anchor.workspace.Qraffle as Program<Qraffle>;
    
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    const authoritySecret = JSON.parse(require('fs').readFileSync('/home/mpetac/.config/solana/id.json', 'utf8'));
    const authorityKeypair = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(authoritySecret));

    const raffle_price = 10000;
    const raffle_start = Math.round(Date.now() / 1000);
    const raffle_end = Math.round(Date.now() / 1000 + 3600);
    const raffle_tickets = 10;
    const adminKeypair = anchor.web3.Keypair.generate();
    const falseAdminKeypair = anchor.web3.Keypair.generate();
    const entrantsKeypair = anchor.web3.Keypair.generate();
    
    let proceedsMint: PublicKey;
    let adminSettingsAccount: PublicKey;
    let raffleAccount: PublicKey;
    let proceedsAccount: PublicKey;
    
    before( async () => {
        const airdropSignature1 = await provider.connection.requestAirdrop(adminKeypair.publicKey, 1e9);
        await provider.connection.confirmTransaction(airdropSignature1);
        
        const airdropSignature2 = await provider.connection.requestAirdrop(falseAdminKeypair.publicKey, 1e9);
        await provider.connection.confirmTransaction(airdropSignature2);
        
        
        proceedsMint = spl.NATIVE_MINT;
        //proceedsMint = await spl.createMint(provider.connection, authorityKeypair, authorityKeypair.publicKey, null, 6);
        
        let bump = null;
        [adminSettingsAccount, bump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("admin")], program.programId);
        [raffleAccount, bump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("raffle"), entrantsKeypair.publicKey.toBuffer()], program.programId);
        [proceedsAccount, bump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("proceeds"), raffleAccount.toBuffer()], program.programId);
        
        console.log(`\t-------------------- Starting new raffle --------------------`);
        console.log(`\tAuthority        : ${authorityKeypair.publicKey.toString()}`);
        console.log(`\tAdmin            : ${adminKeypair.publicKey.toString()}`);
        console.log(`\tMint             : ${proceedsMint.toString()}`);
        console.log(`\tRaffle account   : ${raffleAccount.toString()}`);
        console.log(`\tEntrants account : ${entrantsKeypair.publicKey.toString()}`);
        console.log(`\tProceeds account : ${proceedsAccount.toString()}`);
        console.log(`\t-------------------------------------------------------------`);
        
        const size_entrants = 8 + 4 + 4 + 32 * raffle_tickets;
        const lamports_entrants = await provider.connection.getMinimumBalanceForRentExemption(8 + 4 + 4 + 32 * raffle_tickets);
        const tx = new anchor.web3.Transaction();
        tx.add(anchor.web3.SystemProgram.createAccount({
            fromPubkey: adminKeypair.publicKey,
            newAccountPubkey: entrantsKeypair.publicKey,
            lamports: lamports_entrants,
            space: size_entrants,
            programId: program.programId,
        }));
        
        const signature = await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [adminKeypair, entrantsKeypair], {skipPreflight: true});
        console.log(`\tCreated entrants account: ${signature}`);
    });
    
    it('Set raffles admin!', async () => {
        
        const adminSettingsInfo = await provider.connection.getAccountInfo(adminSettingsAccount);
        if (adminSettingsInfo) {
            const signature = await program.rpc.setAdmin(adminKeypair.publicKey, {
                accounts: {
                    adminSettings: adminSettingsAccount,
                    program: program.programId,
                    programData: new PublicKey('2vPqnZ1snm25ytwuFJDBe7EHZY4NudMCZBTJ5tW7PC7Y'),
                    authority: authorityKeypair.publicKey,
                },
            });
            console.log(`\tSet admin settings transaction: ${signature}`);
        } else {
            const signature = await program.rpc.initAdmin(adminKeypair.publicKey, {
                accounts: {
                    adminSettings: adminSettingsAccount,
                    program: program.programId,
                    programData: new PublicKey('2vPqnZ1snm25ytwuFJDBe7EHZY4NudMCZBTJ5tW7PC7Y'),
                    authority: authorityKeypair.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                },
            });
            console.log(`\tInit admin settings transaction: ${signature}`);
        }
        
        const adminSettingsData = await program.account.adminSettings.fetch(adminSettingsAccount);
        assert.equal(adminSettingsData.adminKey.toString(), adminKeypair.publicKey.toString());
        
    });
    
    it('Initialized the raffle!', async () => {
        
        const keypair = adminKeypair;
        //const keypair = falseAdminKeypair;
        
        const tx = await program.transaction.initialize(new anchor.BN(raffle_price), new anchor.BN(raffle_start),  new anchor.BN(raffle_end), new anchor.BN(raffle_tickets), {
            accounts: {
                adminSettings: adminSettingsAccount,
                raffle: raffleAccount,
                entrants: entrantsKeypair.publicKey,
                proceeds: proceedsAccount,
                proceedsMint: proceedsMint,
                authority: keypair.publicKey,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            },
        });
        const signature = await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [keypair], {skipPreflight: true});
        console.log(`\tInitialize transaction: ${signature}`);
        
        const raffleAccountData = await program.account.raffle.fetch(raffleAccount);
        assert.equal(raffleAccountData.price, raffle_price);
        assert.equal(raffleAccountData.endTimestamp, raffle_end);
        
        const entrantsKeypairData = await program.account.entrants.fetch(entrantsKeypair.publicKey);
        assert.equal(entrantsKeypairData.total, 0);
        assert.equal(entrantsKeypairData.max, raffle_tickets);
        
    });
    
    it('Bought the raffle tickets!', async () => {
        let purchased_tickets = 0;
        while (purchased_tickets < raffle_tickets) {
            const nTickets = Math.ceil(Math.random() * (raffle_tickets - purchased_tickets));
            const buyerKeypair = anchor.web3.Keypair.generate();
            const airdropSignature = await provider.connection.requestAirdrop(buyerKeypair.publicKey, 1e9);
            await provider.connection.confirmTransaction(airdropSignature);
            
            console.log(`\tUser ${buyerKeypair.publicKey.toString()} buying ${nTickets} tickets`);
            
            let buyerTokenAccount;
            if (proceedsMint == spl.NATIVE_MINT) {
                buyerTokenAccount = await spl.createWrappedNativeAccount(provider.connection, buyerKeypair, buyerKeypair.publicKey, nTickets * raffle_price);
            } else {
                buyerTokenAccount = await spl.createAssociatedTokenAccount(provider.connection, buyerKeypair, proceedsMint, buyerKeypair.publicKey);
                const mintSignature = await spl.mintTo(provider.connection, authorityKeypair, proceedsMint, buyerTokenAccount, authorityKeypair, nTickets * raffle_price);
                console.log(`\tMint transaction: ${mintSignature}`);
            }
            
            const tx = await program.transaction.buy(new anchor.BN(nTickets), {
                accounts: {
                    raffle: raffleAccount,
                    entrants: entrantsKeypair.publicKey,
                    proceeds: proceedsAccount,
                    buyerTokenAccount: buyerTokenAccount,
                    buyer: buyerKeypair.publicKey,
                    tokenProgram: spl.TOKEN_PROGRAM_ID
                },
            });
            const signature = await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [buyerKeypair], {skipPreflight: true});
            console.log(`\tBuy ticket transaction: ${signature}`);
            
            const entrantsKeypairData = await program.account.entrants.fetch(entrantsKeypair.publicKey);
            assert.equal(entrantsKeypairData.total, purchased_tickets + nTickets);
            assert.equal(entrantsKeypairData.max, raffle_tickets);
            
            const accountInfo = await provider.connection.getAccountInfo(entrantsKeypair.publicKey);
            for (let i = 0; i < nTickets; i++) {
                const index = 16 + (purchased_tickets + i) * 32;
                const addedKey = new PublicKey(accountInfo.data.slice(index, index + 32));
                assert.equal(buyerKeypair.publicKey.toString(), addedKey.toString());
                console.log(`\tEntrant ${purchased_tickets + i}: ${addedKey.toString()}`);
            }
            purchased_tickets += nTickets;
        }
    });
    
    it('Closed the raffle!', async () => {
        
        const keypair = adminKeypair;
        //const keypair = falseAdminKeypair;
        
        let adminProceedesAccount = await spl.getOrCreateAssociatedTokenAccount(provider.connection, keypair, proceedsMint, keypair.publicKey);
        
        const adminProceedesAccountInfo = await provider.connection.getAccountInfo(adminProceedesAccount.address);
        
        const tx = await program.transaction.close({
            accounts: {
                adminSettings: adminSettingsAccount,
                raffle: raffleAccount,
                entrants: entrantsKeypair.publicKey,
                proceeds: proceedsAccount,
                authorityProceeds: adminProceedesAccount.address,
                authority: keypair.publicKey,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
            },
        });
        const signature = await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [keypair], {skipPreflight: true});
        console.log(`\tClose transaction: ${signature}`);
    });
});
