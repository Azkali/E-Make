import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if ( environment.common.production ) {
	enableProdMode();
}
console.log( environment );
platformBrowserDynamic().bootstrapModule( AppModule )
	.catch( err => console.log( err ) );