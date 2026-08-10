import { Module } from "@nestjs/common";

import { PublicContentContextResolver } from "./public-content-context-resolver";
import { PublicContentWindowResolver } from "./public-content-window-resolver";

@Module({
  exports: [PublicContentContextResolver, PublicContentWindowResolver],
  providers: [PublicContentContextResolver, PublicContentWindowResolver],
})
export class PublicContentModule {}
