/// <reference path="./types/index.d.ts"/>

import { ObjectID } from 'bson';
import express from 'express';
import { sign } from 'jsonwebtoken';
import mongoose from 'mongoose';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github';
import { OAuth2Strategy as GoogleStrategy } from 'passport-google-oauth';
import { User } from './models';

import { assign } from 'lodash';
import { logger } from './logger';

import { backConfig } from '../cross/config/environments/loader';
import { makeAbsoluteUrl } from '../cross/config/utils';
import { EAuthorization, IUser } from '../cross/models';

passport.serializeUser( async ( user: mongoose.Document & IUser, done: ( err: Error | null, user: any ) => void ) => {
	done( null, user._id );
} );

passport.deserializeUser( async ( userId: ObjectID, done: ( err: Error | null, user: any ) => void ) => {
	done( null, await User.findById( userId ).exec() );
} );

const authConfig = backConfig.authMethods;

// Load configs
if ( authConfig.google ) {
	passport.use( new GoogleStrategy(
		{
			clientID: authConfig.google.appId,
			clientSecret: authConfig.google.appSecret,
			callbackURL: makeAbsoluteUrl( backConfig.common.back ) + authConfig.google.redirectUrl,
		},
		async ( accessToken, refreshToken, profile, done ) => {
			console.log( { accessToken, refreshToken, profile } );
			const user = await User.findOne( { googleId: profile.id } ).exec();
			logger.info( 'Logging in user for Google ID: ' + profile.id );
			if ( user ) {
				logger.silly( `Retrieved user ${user._id} for Google ID ${profile.id}` );
				return done( undefined, user );
			} else {
				try {
					const createdUser = new User( { googleId: profile.id, authorizations: EAuthorization.User } );
					if ( !createdUser ) {
						throw new Error( 'Could not create a new user' );
					}
					logger.verbose( `Created new user ${createdUser._id} for Google ID ${profile.id}` );
					return done( undefined, createdUser );
				} catch ( e ) {
					logger.error( `An error occured when creating user for Google ID ${profile.id}: ${e.message}` );
					return done( e, undefined );
				}
			}
		},
	) );
		}
if ( authConfig.github ) {
	passport.use( new GitHubStrategy(
		{
			clientID: authConfig.github.appId,
			clientSecret: authConfig.github.appSecret,
			callbackURL: makeAbsoluteUrl( backConfig.common.back ) + authConfig.github.redirectUrl,
		},
		async ( accessToken, refreshToken, profile, done ) => {
			console.log( { accessToken, refreshToken, profile } );
			const user = await User.findOne( { githubId: profile.id } ).exec();
			logger.info( 'Logging in user for Github ID: ' + profile.id );
			if ( user ) {
				logger.silly( `Retrieved user ${user._id} for Github ID ${profile.id}` );
				return done( undefined, user );
			} else {
				try {
					const createdUser = new User( { githubId: profile.id, authorizations: EAuthorization.User } );
					await createdUser.save();
					logger.verbose( `Created new user ${createdUser._id} for Github ID ${profile.id}` );
					return done( undefined, createdUser );
				} catch ( e ) {
					logger.error( `An error occured when creating user for Github ID ${profile.id}: ${e.message}` );
					return done( e, undefined );
			}
			}
		},
	) );
}

const createToken = ( auth: any ) =>
	sign(
		{ id: auth.id },
		backConfig.tokenSecret,
		{ expiresIn: 60 * 120 },
	);

const generateToken = ( req: express.Request, res: express.Response, next: express.NextFunction ) => {
	req.token = createToken( req.auth );
	next();
};

const sendToken = ( req: express.Request, res: express.Response ) => {
	if ( !req.token ) {
		const message = 'Missing token';
		logger.error( `An error occured when setting user session: ${message}` );
		throw new Error( message );
	}
	req.session = assign( req.session, { auth: req.auth, token: req.token } );
	res.setHeader( 'x-auth-token', req.token );
	res.redirect( `${makeAbsoluteUrl( backConfig.common.front )}/${backConfig.common.front.afterAuthRoute}` );
};

export const initializePassport = ( app: express.Express ) => {
	app.use( passport.initialize() );
	app.use( passport.session() );

	app.get(
		'/auth/status',
		( req, res ) => {
			logger.verbose( 'Retrieving the authentication status' );
			if ( req.session && req.session.token ) {
				logger.debug( `User with IP ${req.ip} is authenticated with session id ${req.session.token}` ); // Is it RGPD compliant ?
				return res.status( 200 ).json( { token: req.session.token } );
			} else {
				logger.debug( `User with IP ${req.ip} is NOT authenticated` ); // Is it RGPD compliant ?
				return res.status( 401 ).send( 'Unauthenticated' );
			}
		},
	);

	// GET /auth/google
	//   Use passport.authenticate() as route middleware to authenticate the
	//   request.  The first step in Google authentication will involve
	//   redirecting the user to google.com.  After authorization, Google
	//   will redirect the user back to this application at /auth/google/callback
	app.get(
		`${backConfig.common.back.auth.baseAuthRoute}/google`,
		passport.authenticate( 'google', {
			scope: [
			'email',
			'profile',
			],
		} ),
	);

	if ( authConfig.google ) {
		// GET /auth/google/callback
		//   Use passport.authenticate() as route middleware to authenticate the
		//   request.  If authentication fails, the user will be redirected back to the
		//   login page.  Otherwise, the primary route function function will be called,
		//   which, in this example, will redirect the user to the home page.
		app.get(
			authConfig.google.redirectUrl,
			passport.authenticate( 'google', { failureRedirect: '/login' } ),
			( req, res, next ) => {
				if ( !req.user ) {
					return res.sendStatus( 401 );
				}

				// prepare token for API
				req.auth = {
					id: req.user.getId( 'main' ),
				};

				next();
			},
			generateToken,
			sendToken,
		);
	}

	app.get(
		`${backConfig.common.back.auth.baseAuthRoute}/github`,
		passport.authenticate( 'github', {
			scope: [
				'email',
				'profile',
			],
		} ),
	);

	if ( authConfig.github ) {
		// GET /auth/github/callback
		//   Use passport.authenticate() as route middleware to authenticate the
		//   request.  If authentication fails, the user will be redirected back to the
		//   login page.  Otherwise, the primary route function function will be called,
		//   which, in this example, will redirect the user to the home page.
		app.get(
			authConfig.github.redirectUrl,
			passport.authenticate( 'github', { failureRedirect: '/login' } ),
			( req, res, next ) => {
				if ( !req.user ) {
					return res.sendStatus( 401 );
				}

				// prepare token for API
				req.auth = {
					id: req.user.getId( 'main' ),
				};

				next();
			},
			generateToken,
			sendToken,
		);
	}
};
