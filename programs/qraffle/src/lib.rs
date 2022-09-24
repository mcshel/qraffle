use crate::program::Qraffle;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token::{self, Mint, TokenAccount};
use std::cell::{Ref, RefMut};

declare_id!("Cfy2pLkC4e9e4krHHSfA34QuwVD4tyQCecNYsh8kp2wy");

#[program]
pub mod qraffle {
    use super::*;
    
    
    pub fn init_admin(ctx: Context<InitAdmin>, admin_key: Pubkey) -> Result<()> {
        let admin_settings = &mut ctx.accounts.admin_settings;
        admin_settings.admin_key = admin_key;
        
        Ok(())
    }
    
    
    pub fn set_admin(ctx: Context<SetAdmin>, admin_key: Pubkey) -> Result<()> {
        let admin_settings = &mut ctx.accounts.admin_settings;
        admin_settings.admin_key = admin_key;
        
        Ok(())
    }
    
    pub fn initialize(ctx: Context<Initialize>, price: u64, end_timestamp: i64, max_entrants: u32) -> Result<()> {
        
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < end_timestamp,
            RaffleError::EndTimestampAlreadyPassed
        );
        
        let raffle = &mut ctx.accounts.raffle;
        raffle.bump = *ctx.bumps.get("raffle").unwrap();
        raffle.price = price;
        raffle.end_timestamp = end_timestamp;
        raffle.entrants = ctx.accounts.entrants.key();
        
        let entrants = &mut ctx.accounts.entrants;
        entrants.total = 0;
        entrants.max = max_entrants;
        
        require!(
            entrants.to_account_info().data_len() >= Entrants::BASE_SIZE + 32 * max_entrants as usize,
            RaffleError::EntrantsAccountTooSmallForMaxEntrants
        );
        
        Ok(())

    }
    
    pub fn buy(ctx: Context<Buy>, amount: u32) -> Result<()> {
        
        let clock = Clock::get()?;
        let raffle = &mut ctx.accounts.raffle;
        require!(
            clock.unix_timestamp < raffle.end_timestamp,
            RaffleError::RaffleEnded
        );
        
        let entrants = &mut ctx.accounts.entrants;
        let entrants_account_into = entrants.to_account_info();
        for _ in 0..amount {
            entrants.append_entrant(entrants_account_into.data.borrow_mut(), ctx.accounts.buyer_token_account.owner)?;
        }
        
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.proceeds.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            raffle.price.checked_mul(amount as u64).ok_or(RaffleError::InvalidCalculation)?,
        )?;

        msg!("Total entrants: {}", entrants.total);
        
        Ok(())
    }
    
    pub fn close(ctx: Context<Close>) -> Result<()> {
        let clock = Clock::get()?;
        let raffle = &ctx.accounts.raffle;
        let entrants = &ctx.accounts.entrants;
        let proceeds = &ctx.accounts.proceeds;
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.proceeds.to_account_info(),
                    to: ctx.accounts.authority_proceeds.to_account_info(),
                    authority: ctx.accounts.raffle.to_account_info(),
                },
                &[&[b"raffle".as_ref(), raffle.entrants.as_ref(), &[raffle.bump]]],
            ),
            proceeds.amount,
        )?;
        
        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: ctx.accounts.proceeds.to_account_info(),
                    destination: ctx.accounts.authority.to_account_info(),
                    authority: ctx.accounts.raffle.to_account_info(),
                },
                &[&[b"raffle".as_ref(), raffle.entrants.as_ref(), &[raffle.bump]]],
            )
        )?;
        
        require!(
            clock.unix_timestamp > raffle.end_timestamp || entrants.total == entrants.max,
            RaffleError::RaffleStillRunning
        );

        Ok(())
    }
}


#[derive(Accounts)]
pub struct InitAdmin<'info> {
    #[account(
        init,
        seeds = [b"admin".as_ref()], 
        bump, 
        payer = authority,
        space = 8 + 32,
    )]
    pub admin_settings: Account<'info, AdminSettings>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Qraffle>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()))]
    pub program_data: Account<'info, ProgramData>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct SetAdmin<'info> {
    #[account(mut, seeds = [b"admin".as_ref()], bump)]
    pub admin_settings: Account<'info, AdminSettings>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Qraffle>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()))]
    pub program_data: Account<'info, ProgramData>,
    #[account(mut)]
    pub authority: Signer<'info>,
    
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(seeds = [b"admin".as_ref()], bump)]
    pub admin_settings: Account<'info, AdminSettings>,
    #[account(
        init, 
        seeds = [b"raffle".as_ref(), entrants.key().as_ref()], 
        bump, 
        payer = authority, 
        space = 8 + 1 + 8 + 8 + 32,
    )]
    pub raffle: Account<'info, Raffle>,
    #[account(zero)]
    pub entrants: Account<'info, Entrants>,
    #[account(
        init,
        seeds = [b"proceeds".as_ref(), raffle.key().as_ref()],
        bump,
        payer = authority,
        token::mint = proceeds_mint,
        token::authority = raffle,
    )]
    pub proceeds: Account<'info, TokenAccount>,
    pub proceeds_mint: Account<'info, Mint>,
    #[account(mut, constraint = admin_settings.admin_key == authority.key())]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(has_one = entrants)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub entrants: Account<'info, Entrants>,
    #[account(
        mut,
        seeds = [b"proceeds".as_ref(), raffle.key().as_ref()],
        bump,
    )]
    pub proceeds: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(seeds = [b"admin".as_ref()], bump)]
    pub admin_settings: Account<'info, AdminSettings>,
    #[account(mut, has_one = entrants, close = authority)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut, close = authority)]
    pub entrants: Account<'info, Entrants>,
    #[account(
        mut,
        seeds = [b"proceeds".as_ref(), raffle.key().as_ref()],
        bump
    )]
    pub proceeds: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority_proceeds.owner == authority.key())]
    pub authority_proceeds: Account<'info, TokenAccount>,
    #[account(constraint = admin_settings.admin_key == authority.key())]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}


#[account]
pub struct AdminSettings {
    pub admin_key: Pubkey,
}

#[account]
pub struct Raffle {
    pub bump: u8,
    pub price: u64,
    pub end_timestamp: i64,
    pub entrants: Pubkey,
}

#[account]
pub struct Entrants {
    pub total: u32,
    pub max: u32,
}

impl Entrants {
    const BASE_SIZE: usize = 8 + 4 + 4;

    pub fn get_entrant(entrants_data: Ref<&mut [u8]>, index: usize) -> Pubkey {
        let start_index = Entrants::BASE_SIZE + 32 * index;
        Pubkey::new(&entrants_data[start_index..start_index + 32])
    }

    fn append_entrant(
        &mut self,
        mut entrants_data: RefMut<&mut [u8]>,
        entrant: Pubkey,
    ) -> Result<()> {
        if self.total >= self.max {
            return Err(RaffleError::NotEnoughTicketsLeft.into());
        }
        let current_index = Entrants::BASE_SIZE + 32 * self.total as usize;
        let entrant_slice: &mut [u8] = &mut entrants_data[current_index..current_index + 32];
        entrant_slice.copy_from_slice(&entrant.to_bytes());
        self.total += 1;

        Ok(())
    }
}


#[error_code]
pub enum RaffleError {
    #[msg("End timestamp already passed")]
    EndTimestampAlreadyPassed,
    #[msg("Entrants account too small for max entrants")]
    EntrantsAccountTooSmallForMaxEntrants,
    #[msg("Raffle has ended")]
    RaffleEnded,
    #[msg("Invalid calculation")]
    InvalidCalculation,
    #[msg("Not enough tickets left")]
    NotEnoughTicketsLeft,
    #[msg("Raffle is still running")]
    RaffleStillRunning,
}
