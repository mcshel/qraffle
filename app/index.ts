import * as anchor from '@project-serum/anchor';
import { 
    Connection, 
    PublicKey, 
    Keypair,
    Transaction, 
    TransactionInstruction, 
    sendAndConfirmTransaction,
} from '@solana/web3.js'; 


const main = async () => {
    const idl = JSON.parse(require("fs").readFileSync("../target/idl/qraffle.json", "utf8"));
    const programId = new anchor.web3.PublicKey("Cfy2pLkC4e9e4krHHSfA34QuwVD4tyQCecNYsh8kp2wy");
    const program = new anchor.Program(idl, programId);
}

main();
